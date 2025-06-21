// src/services/orchestrator.js
const { runCrawler } = require('./crawler');
const parser = require('./parser');
const metadata = require('./metadata');
const crud = require('../database/crud');
const logger = require('../utils/logger');
const { models } = require('../database/connection');

let isCrawling = false;

/**
 * Processes a single thread scraped from the forum.
 * This is the core logic that decides whether to create, update, or skip an item.
 * @param {object} threadData - Contains raw_title, magnet_uris, and thread_hash.
 */
const processThread = async (threadData) => {
    const { thread_hash, raw_title, magnet_uris } = threadData;

    try {
        // Find if a thread with this *title* already exists to detect updates
        const existingThread = await models.Thread.findOne({ where: { raw_title } });

        if (existingThread) {
            if (existingThread.thread_hash === thread_hash) {
                logger.debug(`Skipping unchanged thread: ${raw_title}`);
                await existingThread.update({ last_seen: new Date() });
                return;
            } else {
                logger.info(`Thread content has changed. Re-processing: ${raw_title}`);
                // Destroying the old record simplifies the logic. The new record will be created.
                // Streams associated with the old metadata will eventually become orphaned but won't be served.
                await existingThread.destroy();
            }
        }
        
        logger.info(`Processing new or updated thread: ${raw_title}`);

        // 1. Normalize Title using the parser service
        const parsedTitle = await parser.parseTitle(raw_title);
        if (!parsedTitle) {
            await crud.logFailedThread(thread_hash, raw_title, 'Title parsing failed critically.');
            return;
        }

        // 2. TMDB Lookup using the metadata service
        const tmdbData = await metadata.getTmdbMetadata(parsedTitle.clean_title, parsedTitle.year);

        if (tmdbData && tmdbData.dbEntry) {
            // --- SUCCESS PATH: A TMDB match was found ---
            const { dbEntry } = tmdbData;
            logger.info(`TMDB match found for "${parsedTitle.clean_title}": ${dbEntry.tmdb_id}`);
            
            await models.TmdbMetadata.upsert(dbEntry);

            await crud.createOrUpdateThread({
                thread_hash,
                raw_title,
                clean_title: parsedTitle.clean_title,
                year: parsedTitle.year,
                tmdb_id: dbEntry.tmdb_id,
                status: 'linked',
                magnet_uris: null // Magnets will be processed, no need to store them
            });

            // 3. Parse Magnets and create stream records
            const streamsToCreate = [];
            for (const magnet of magnet_uris) {
                const streamDetails = await parser.parseMagnet(magnet);
                if (streamDetails && streamDetails.episodes.length > 0) {
                    for (const episode of streamDetails.episodes) {
                        streamsToCreate.push({
                            tmdb_id: dbEntry.tmdb_id,
                            season: streamDetails.season,
                            episode,
                            infohash: streamDetails.infohash,
                            quality: streamDetails.quality,
                            language: streamDetails.language,
                        });
                    }
                }
            }
            if (streamsToCreate.length > 0) {
                await crud.createStreams(streamsToCreate);
                logger.info(`Added ${streamsToCreate.length} stream entries for ${parsedTitle.clean_title}`);
            }

        } else {
            // --- FAILURE PATH: No TMDB match found, save as 'pending' ---
            logger.warn(`No TMDB match for "${parsedTitle.clean_title}". Saving as 'pending_tmdb'.`);
            await crud.createOrUpdateThread({
                thread_hash,
                raw_title,
                clean_title: parsedTitle.clean_title,
                year: parsedTitle.year,
                tmdb_id: null,
                status: 'pending_tmdb',
                magnet_uris: magnet_uris, // Store magnets for later rescue
            });
        }
    } catch (error) {
        logger.error({ err: error, title: raw_title }, 'An unexpected error occurred in processThread.');
    }
};

/**
 * The main workflow function that runs the crawler.
 * It includes a flag to prevent multiple crawls from running simultaneously.
 */
const runFullWorkflow = async () => {
    if (isCrawling) {
        logger.warn("Crawl is already in progress. Skipping this trigger.");
        return;
    }
    
    isCrawling = true;
    logger.info("🚀 Starting full crawling and processing workflow...");
    
    try {
        await runCrawler(processThread);
    } catch (error) {
        logger.error(error, "The crawling workflow encountered a fatal error.");
    } finally {
        isCrawling = false;
        logger.info("✅ Workflow finished.");
    }
};

module.exports = { runFullWorkflow, isCrawling };
