// src/services/orchestrator.js
const { runCrawler } = require('./crawler');
const parser = require('./parser');
const metadata = require('./metadata');
const crud = require('../database/crud');
const logger = require('../utils/logger');
const { models } = require('../database/connection');

let isCrawling = false;
let dashboardCache = { linked: 0, pending: 0, failed: 0, lastUpdated: null };

async function updateDashboardCache() {
    try {
        logger.info('Updating dashboard cache...');
        const linked = await models.Thread.count({ where: { status: 'linked' } });
        const pending = await models.Thread.count({ where: { status: 'pending_tmdb' } });
        const failed = await models.FailedThread.count();
        dashboardCache = { linked, pending, failed, lastUpdated: new Date() };
        logger.info({ cache: dashboardCache }, 'Dashboard cache updated successfully.');
    } catch (error) {
        logger.error(error, 'Failed to update dashboard cache.');
    }
}

function getDashboardCache() { return dashboardCache; }

// FIX: This function now contains the core application logic loop.
const runFullWorkflow = async () => {
    if (isCrawling) {
        logger.warn("Crawl is already in progress. Skipping this trigger.");
        return;
    }
    
    isCrawling = true;
    logger.info("🚀 Starting full crawling and processing workflow...");
    
    try {
        // 1. Crawl first to get all raw data
        const allScrapedThreads = await runCrawler();
        
        // 2. Now, process the collected data with the correct skip logic
        for (const threadData of allScrapedThreads) {
            const { thread_hash, raw_title, magnet_uris } = threadData;

            const existingThread = await models.Thread.findOne({ where: { raw_title } });

            if (existingThread) {
                // --- THIS IS THE EFFICIENT SKIP LOGIC ---
                if (existingThread.thread_hash === thread_hash) {
                    logger.debug(`Skipping unchanged thread: ${raw_title}`);
                    // We can optionally update a 'last_seen' timestamp here if desired
                    // await existingThread.update({ last_seen: new Date() });
                    continue; // <- The 'continue' statement skips to the next item in the loop
                } else {
                    logger.info(`Thread content has changed. Re-processing: ${raw_title}`);
                    await existingThread.destroy();
                }
            }
            
            logger.info(`Processing new or updated thread: ${raw_title}`);
            // --- HEAVY PROCESSING ONLY HAPPENS BELOW THIS LINE ---

            const parsedTitle = parser.parseTitle(raw_title);
            if (!parsedTitle) {
                await crud.logFailedThread(thread_hash, raw_title, 'Title parsing failed critically.');
                continue;
            }

            const tmdbData = await metadata.getTmdbMetadata(parsedTitle.clean_title, parsedTitle.year);

            if (tmdbData && tmdbData.dbEntry) {
                const { dbEntry } = tmdbData;
                await models.TmdbMetadata.upsert(dbEntry);

                await crud.createOrUpdateThread({
                    thread_hash, raw_title,
                    clean_title: parsedTitle.clean_title, year: parsedTitle.year,
                    tmdb_id: dbEntry.tmdb_id, status: 'linked', magnet_uris: null
                });

                const streamsToCreate = [];
                for (const magnet_uri of magnet_uris) {
                    const streamDetails = parser.parseMagnet(magnet_uri); 
                    if (streamDetails && streamDetails.episodes.length > 0) {
                        for (const episode of streamDetails.episodes) {
                            streamsToCreate.push({
                                tmdb_id: dbEntry.tmdb_id, season: streamDetails.season,
                                episode, infohash: streamDetails.infohash,
                                quality: streamDetails.quality, language: streamDetails.language,
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
                await crud.createOrUpdateThread({
                    thread_hash, raw_title,
                    clean_title: parsedTitle.clean_title, year: parsedTitle.year,
                    tmdb_id: null, status: 'pending_tmdb', magnet_uris: magnet_uris,
                });
            }
        }

    } catch (error) {
        logger.error(error, "The crawling workflow encountered a fatal error.");
    } finally {
        isCrawling = false;
        await updateDashboardCache();
        logger.info("✅ Workflow finished.");
    }
};

module.exports = { runFullWorkflow, isCrawling, updateDashboardCache, getDashboardCache };
