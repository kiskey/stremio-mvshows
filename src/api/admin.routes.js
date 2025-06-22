// src/api/admin.routes.js
const express = require('express');
const router = express.Router();
const { runFullWorkflow, getDashboardCache, updateDashboardCache } = require('../services/orchestrator'); 
const { models } = require('../database/connection');
const metadata = require('../services/metadata');
const parser = require('../services/parser');
const crud = require('../database/crud');
const logger = require('../utils/logger');

router.post('/trigger-crawl', (req, res) => {
    runFullWorkflow();
    res.status(202).json({ message: "Crawl workflow triggered successfully. Check logs for progress." });
});

router.get('/dashboard', async (req, res) => {
    const cachedStats = getDashboardCache();
    if (!cachedStats.lastUpdated) {
        await updateDashboardCache();
        return res.json(getDashboardCache());
    }
    res.json(cachedStats);
});

router.get('/pending', async (req, res) => {
    try {
        const pendingThreads = await models.Thread.findAll({
            where: { status: 'pending_tmdb' },
            order: [['updatedAt', 'DESC']],
        });
        res.json(pendingThreads);
    } catch (error) {
        logger.error(error, "Failed to fetch pending threads.");
        res.status(500).json({ message: "Error fetching pending threads." });
    }
});

router.get('/failures', async (req, res) => {
    try {
        const failedThreads = await models.FailedThread.findAll({
            order: [['last_attempt', 'DESC']],
        });
        res.json(failedThreads);
    } catch (error) {
        logger.error(error, "Failed to fetch critical failures.");
        res.status(500).json({ message: "Error fetching critical failures." });
    }
});

router.post('/update-pending', async (req, res) => {
    const { threadId, poster, description } = req.body;
    if (!threadId) {
        return res.status(400).json({ message: 'threadId is required.' });
    }
    try {
        const thread = await models.Thread.findByPk(threadId);
        if (!thread || thread.status !== 'pending_tmdb') {
            return res.status(404).json({ message: 'Pending thread not found.' });
        }
        thread.custom_poster = poster || null;
        thread.custom_description = description || null;
        await thread.save();
        res.json({ message: `Successfully updated pending metadata for "${thread.clean_title}".` });
    } catch (error) {
        logger.error(error, 'Update pending operation failed.');
        res.status(500).json({ message: 'An internal error occurred during update.' });
    }
});

// --- DEFINITIVELY CORRECTED 'rescue' endpoint ---
router.post('/link-official', async (req, res) => {
    const { threadId, manualId } = req.body;
    if (!threadId || !manualId) {
        return res.status(400).json({ message: 'threadId and manualId are required.' });
    }

    try {
        const thread = await models.Thread.findByPk(threadId);
        if (!thread || thread.status !== 'pending_tmdb') {
            return res.status(404).json({ message: 'Pending thread not found.' });
        }

        const tmdbData = await metadata.getTmdbMetadataById(manualId);
        if (!tmdbData) {
            return res.status(400).json({ message: `Could not find a match for ID: ${manualId}` });
        }
        
        await models.TmdbMetadata.upsert(tmdbData.dbEntry);
        
        thread.tmdb_id = tmdbData.dbEntry.tmdb_id;
        thread.status = 'linked';
        
        const streamsToCreate = [];
        // FIX: Ensure thread.magnet_uris is treated as an array, even if it's null/undefined initially.
        const magnetUris = thread.magnet_uris || [];

        for (const magnet_uri of magnetUris) {
            const streamDetails = parser.parseMagnet(magnet_uri);
            if (streamDetails && streamDetails.season) {
                // This logic correctly populates the streamsToCreate array
                let streamEntry = {
                    tmdb_id: tmdbData.dbEntry.tmdb_id,
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
            await crud.createStreams(streamsToCreate);
        }
        
        // Clean up the now-processed fields
        thread.magnet_uris = null;
        thread.custom_poster = null;
        thread.custom_description = null;
        await thread.save();
        
        await updateDashboardCache();

        res.json({ message: `Successfully linked "${thread.clean_title}" and created ${streamsToCreate.length} streams.` });

    } catch (error) {
        logger.error(error, 'Rescue operation failed.');
        res.status(500).json({ message: 'An internal error occurred during rescue.' });
    }
});

module.exports = router;
