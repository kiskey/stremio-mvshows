// src/services/orchestrator.js
const { runCrawler } = require('./crawler');
const parser = require('./parser');
const metadata = require('./metadata');
const crud = require('../database/crud');
const logger = require('../utils/logger');
const { models, sequelize } = require('../database/connection'); // Import sequelize for transactions

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

const runFullWorkflow = async () => {
    if (isCrawling) {
        logger.warn("Crawl is already in progress. Skipping this trigger.");
        return;
    }
    
    isCrawling = true;
    logger.info("🚀 Starting full crawling and processing workflow...");
    
    try {
        const allScrapedThreads = await runCrawler();
        
        let processedCount = 0;
        let skippedCount = 0;

        for (const threadData of allScrapedThreads) {
            const { thread_hash, raw_title, magnet_uris } = threadData;

            const existingThread = await models.Thread.findOne({ where: { raw_title } });

            if (existingThread) {
                if (existingThread.thread_hash === thread_hash) {
                    skippedCount++;
                    continue;
                } else {
                    logger.info(`Thread content has changed. Re-processing: ${raw_title}`);
                    await existingThread.destroy();
                }
            }
            
            processedCount++;
            logger.info(`Processing new or updated thread: ${raw_title}`);

            const parsedTitle = parser.parseTitle(raw_title);
            if (!parsedTitle) {
                // This is a pre-processing failure, can be logged without a transaction
                await crud.logFailedThread(thread_hash, raw_title, 'Title parsing failed critically.');
                continue;
            }

            const tmdbData = await metadata.getTmdbMetadata(parsedTitle.clean_title, parsedTitle.year);
            
            // --- TRANSACTION START ---
            // All subsequent DB writes for this item will be atomic.
            const t = await sequelize.transaction();
            try {
                if (tmdbData && tmdbData.dbEntry) {
                    const { dbEntry } = tmdbData;
                    await models.TmdbMetadata.upsert(dbEntry, { transaction: t });
                    await crud.createOrUpdateThread({
                        thread_hash, raw_title, clean_title: parsedTitle.clean_title, 
                        year: parsedTitle.year, tmdb_id: dbEntry.tmdb_id, 
                        status: 'linked', magnet_uris: null
                    }, { transaction: t });

                    const streamsToCreate = [];
                    for (const magnet_uri of magnet_uris) {
                        const streamDetails = parser.parseMagnet(magnet_uri); 
                        if (streamDetails && streamDetails.season) {
                            let streamEntry = {
                                tmdb_id: dbEntry.tmdb_id,
                                season: streamDetails.season,
                                infohash: streamDetails.infohash,
                                quality: streamDetails.quality,
                                language: streamDetails.language
                            };
                            if (streamDetails.type === 'SEASON_PACK') {
                                streamEntry.episode = 1;
                                streamEntry.episode_end = 999;
                            } else if (streamDetails.type === 'EPISODE_PACK') {
                                streamEntry.episode = streamDetails.episodeStart;
                                streamEntry.episode_end = streamDetails.episodeEnd;
                            } else if (streamDetails.type === 'SINGLE_EPISODE') {
                                streamEntry.episode = streamDetails.episode;
                                streamEntry.episode_end = streamDetails.episode;
                            }
                            if (streamEntry.episode) {
                                streamsToCreate.push(streamEntry);
                            }
                        }
                    }
                    if (streamsToCreate.length > 0) {
                        await models.Stream.bulkCreate(streamsToCreate, { ignoreDuplicates: true, transaction: t });
                        logger.info(`Upserted ${streamsToCreate.length} stream entries for ${parsedTitle.clean_title}`);
                    }
                } else {
                    logger.warn(`No TMDB match for "${parsedTitle.clean_title}". Saving as 'pending_tmdb'.`);
                    await crud.createOrUpdateThread({
                        thread_hash, raw_title, clean_title: parsedTitle.clean_title,
                        year: parsedTitle.year, tmdb_id: null,
                        status: 'pending_tmdb', magnet_uris: magnet_uris,
                    }, { transaction: t });
                }

                await t.commit(); // If all operations succeed, commit the changes

            } catch (error) {
                await t.rollback(); // If any operation fails, roll back all changes
                logger.error(error, `Transaction failed for thread "${raw_title}". Rolling back changes.`);
                // Optionally log to failed threads table here as well
                await crud.logFailedThread(thread_hash, raw_title, 'DB transaction failed.');
            }
            // --- TRANSACTION END ---
        }
        logger.info({
            totalScraped: allScrapedThreads.length,
            newOrUpdated: processedCount,
            unchangedSkipped: skippedCount
        }, 'Processing complete.');
    } catch (error) {
        logger.error(error, "The crawling workflow encountered a fatal error.");
    } finally {
        isCrawling = false;
        await updateDashboardCache();
        logger.info("✅ Workflow finished.");
    }
};

module.exports = { runFullWorkflow, isCrawling, updateDashboardCache, getDashboardCache };
