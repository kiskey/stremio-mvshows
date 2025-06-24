// src/services/orchestrator.js
const { runCrawler } = require('./crawler');
const parser = require('./parser');
const metadata = require('./metadata');
const rd = require('./realdebrid');
const crud = require('../database/crud');
const logger = require('../utils/logger');
const { models } = require('../database/connection');
const { Op } = require('sequelize');
const config = require('../config/config');

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

// A helper function to introduce a polite delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const runFullWorkflow = async () => {
    if (isCrawling) {
        logger.warn("Crawl is already in progress. Skipping this trigger.");
        return;
    }
    
    isCrawling = true;
    logger.info("🚀 Starting full crawling and processing workflow...");
    
    try {
        const allScrapedThreads = await runCrawler();
        
        if (config.isRdEnabled) {
            const allInfohashes = new Set();
            allScrapedThreads.forEach(thread => {
                thread.magnet_uris.forEach(magnet_uri => {
                    const infohash = parser.getInfohash(magnet_uri);
                    if (infohash) allInfohashes.add(infohash);
                });
            });

            const existingHashes = await models.Hash.findAll({
                where: { infohash: { [Op.in]: Array.from(allInfohashes) } },
                attributes: ['infohash'], raw: true,
            });
            const existingHashSet = new Set(existingHashes.map(h => h.infohash));
            const newHashes = Array.from(allInfohashes).filter(h => !existingHashSet.has(h));
            
            if (newHashes.length > 0) {
                logger.info(`Found ${newHashes.length} new infohashes to check against Real-Debrid.`);
                
                // --- FIX: Implement chunking and delay for rate-limit safety ---
                const chunkSize = 40; // Recommended chunk size by RD community
                const allHashesToSave = [];

                for (let i = 0; i < newHashes.length; i += chunkSize) {
                    const chunk = newHashes.slice(i, i + chunkSize);
                    logger.debug(`Checking RD cache status for chunk ${i / chunkSize + 1}...`);
                    const availability = await rd.checkInstantAvailability(chunk);
                    const chunkToSave = Object.keys(availability).map(hash => ({
                        infohash: hash, is_rd_cached: availability[hash],
                    }));
                    allHashesToSave.push(...chunkToSave);
                    
                    // Add a polite delay between API calls
                    if (i + chunkSize < newHashes.length) {
                        await delay(500); // 0.5-second delay
                    }
                }
                
                await models.Hash.bulkCreate(allHashesToSave, { ignoreDuplicates: true });
                logger.info(`Finished checking all new hashes. ${allHashesToSave.length} hashes updated in local DB.`);
            } else {
                logger.info('No new infohashes found to check against Real-Debrid.');
            }
        }

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
                await crud.logFailedThread(thread_hash, raw_title, 'Title parsing failed critically.');
                continue;
            }
            const tmdbData = await metadata.getTmdbMetadata(parsedTitle.clean_title, parsedTitle.year);
            if (tmdbData && tmdbData.dbEntry) {
                const { dbEntry } = tmdbData;
                await models.TmdbMetadata.upsert(dbEntry);
                await crud.createOrUpdateThread({
                    thread_hash, raw_title, clean_title: parsedTitle.clean_title, 
                    year: parsedTitle.year, tmdb_id: dbEntry.tmdb_id, 
                    status: 'linked', magnet_uris: null
                });
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
                    await models.Stream.bulkCreate(streamsToCreate, { updateOnDuplicate: ['quality', 'language', 'updatedAt'] });
                    logger.info(`Upserted ${streamsToCreate.length} stream entries for ${parsedTitle.clean_title}`);
                }
            } else {
                logger.warn(`No TMDB match for "${parsedTitle.clean_title}". Saving as 'pending_tmdb'.`);
                await crud.createOrUpdateThread({
                    thread_hash, raw_title, clean_title: parsedTitle.clean_title,
                    year: parsedTitle.year, tmdb_id: null,
                    status: 'pending_tmdb', magnet_uris: magnet_uris,
                });
            }
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
