// src/services/orchestrator.js
const { runCrawler } = require('./crawler');
const parser = require('./parser');
const metadata = require('./metadata');
const crud = require('../database/crud');
const logger = require('../utils/logger');
const { models } = require('../database/connection');

let isCrawling = false;

const processThread = async (threadData) => {
    const { thread_hash, raw_title, magnet_uris } = threadData;

    // Find if a thread with this *title* already exists
    const existingThread = await models.Thread.findOne({ where: { raw_title } });

    if (existingThread) {
        // Case 1: Thread exists. Check if it has been updated.
        if (existingThread.thread_hash === thread_hash) {
            // The content is identical, skip.
            logger.debug(`Skipping unchanged thread: ${raw_title}`);
            await models.Thread.update({ last_seen: new Date() }, { where: { thread_hash } });
            return;
        } else {
            // The content has CHANGED. We must re-process.
            logger.info(`Thread has been updated, re-processing: ${raw_title}`);
            // By deleting the old record, we can treat it as a new thread.
            // This cleans up the old hash and avoids primary key conflicts.
            // Streams will be re-added, and UNIQUE constraints will prevent duplicates.
            await existingThread.destroy();
        }
    }
    
    logger.info(`Processing new or updated thread: ${raw_title}`);

    // The rest of the logic proceeds as if it's a new thread
    // 2. Normalize Title
    const parsedTitle = await parser.parseTitle(raw_title);
    if (!parsedTitle) {
        await crud.logFailedThread(thread_hash, raw_title, 'Title parsing failed');
        return;
    }

    // 3. TMDB Lookup
    const tmdbData = await metadata.getTmdbMetadata(parsedTitle.clean_title, parsedTitle.year);
    if (!tmdbData) {
        await crud.logFailedThread(thread_hash, raw_title, 'TMDB lookup failed');
        return;
    }

    await models.TmdbMetadata.upsert(tmdbData.dbEntry);
    await crud.createOrUpdateThread({
        thread_hash,
        raw_title,
        clean_title: parsedTitle.clean_title,
        year: parsedTitle.year,
        tmdb_id: tmdbData.dbEntry.tmdb_id,
    });

    // 4. Parse Magnets and create streams
    const streamsToCreate = [];
    for (const magnet of magnet_uris) {
        const streamDetails = await parser.parseMagnet(magnet);
        if (streamDetails && streamDetails.episodes.length > 0) {
            for (const episode of streamDetails.episodes) {
                streamsToCreate.push({
                    tmdb_id: tmdbData.dbEntry.tmdb_id,
                    season: streamDetails.season,
                    episode: episode,
                    infohash: streamDetails.infohash,
                    quality: streamDetails.quality,
                    language: streamDetails.language,
                });
            }
        }
    }

    if (streamsToCreate.length > 0) {
        await crud.createStreams(streamsToCreate);
        logger.info(`Added ${streamsToCreate.length} stream entries for ${raw_title}`);
    }
};

const runFullWorkflow = async () => {
    if (isCrawling) {
        logger.warn("Crawl is already in progress. Skipping trigger.");
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
