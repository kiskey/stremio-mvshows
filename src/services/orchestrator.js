// src/services/orchestrator.js
const { runCrawler } = require('./crawler');
const parser = require('./parser');
const metadata = require('./metadata');
const crud = require('../database/crud');
const logger = require('../utils/logger');
const { models } = require('../database/connection');

let isCrawling = false;

const processThread = async (threadData) => {
    // FIX: Receive `magnets` as an array of objects
    const { thread_hash, raw_title, magnets } = threadData; 

    try {
        const existingThread = await models.Thread.findOne({ where: { raw_title } });

        if (existingThread) {
            if (existingThread.thread_hash === thread_hash) {
                logger.debug(`Skipping unchanged thread: ${raw_title}`);
                await existingThread.update({ last_seen: new Date() });
                return;
            } else {
                logger.info(`Thread content has changed. Re-processing: ${raw_title}`);
                await existingThread.destroy();
            }
        }
        
        logger.info(`Processing new or updated thread: ${raw_title}`);

        const parsedTitle = parser.parseTitle(raw_title);
        if (!parsedTitle) {
            await crud.logFailedThread(thread_hash, raw_title, 'Title parsing failed critically.');
            return;
        }

        const tmdbData = await metadata.getTmdbMetadata(parsedTitle.clean_title, parsedTitle.year);

        if (tmdbData && tmdbData.dbEntry) {
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
                magnet_uris: null
            });

            const streamsToCreate = [];
            // FIX: Loop through the new magnet objects
            for (const magnet of magnets) {
                const streamDetails = parser.parseMagnet(magnet.uri, magnet.context);
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
            logger.warn(`No TMDB match for "${parsedTitle.clean_title}". Saving as 'pending_tmdb'.`);
            // FIX: Pass the raw magnet URIs for storage
            const magnetUrisForStorage = magnets.map(m => m.uri);
            await crud.createOrUpdateThread({
                thread_hash,
                raw_title,
                clean_title: parsedTitle.clean_title,
                year: parsedTitle.year,
                tmdb_id: null,
                status: 'pending_tmdb',
                magnet_uris: magnetUrisForStorage,
            });
        }
    } catch (error) {
        logger.error({ err: error, title: raw_title }, 'An unexpected error occurred in processThread.');
    }
};

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
