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

    const existing = await crud.findThreadByHash(thread_hash);
    if (existing) {
        logger.debug(`Skipping existing thread hash: ${thread_hash.substring(0, 10)}`);
        await models.Thread.update({ last_seen: new Date() }, { where: { thread_hash } });
        return;
    }
    
    logger.info(`Processing new thread: ${raw_title}`);

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
        last_seen: new Date(),
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
