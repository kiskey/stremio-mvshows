// src/api/admin.routes.js
const express = require('express');
const router = express.Router();
const { runFullWorkflow } = require('../services/orchestrator');
const { models } = require('../database/connection');
const metadata = require('../services/metadata');
const parser = require('../services/parser');
const crud = require('../database/crud');
const logger = require('../utils/logger');

// Endpoint to manually trigger the crawling and processing workflow
// Now accessed via POST /admin/api/trigger-crawl
router.post('/trigger-crawl', (req, res) => {
    runFullWorkflow();
    res.status(202).json({ message: "Crawl workflow triggered successfully. Check logs for progress." });
});

// Endpoint to get statistics for the dashboard UI
// Now accessed via GET /admin/api/dashboard
router.get('/dashboard', async (req, res) => {
    try {
        const linked = await models.Thread.count({ where: { status: 'linked' } });
        const pending = await models.Thread.count({ where: { status: 'pending_tmdb' } });
        const failed = await models.FailedThread.count();
        res.json({ linked, pending, failed });
    } catch (error) {
        logger.error(error, "Failed to fetch dashboard data.");
        res.status(500).json({ message: "Error fetching dashboard data." });
    }
});

// Endpoint to get the list of threads pending a TMDB match
// Now accessed via GET /admin/api/pending
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

// Endpoint to manually rescue a pending thread with a correct ID
// Now accessed via POST /admin/api/rescue
router.post('/rescue', async (req, res) => {
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
        for (const magnet of thread.magnet_uris) {
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
        await crud.createStreams(streamsToCreate);
        
        thread.magnet_uris = null;
        await thread.save();
        
        res.json({ message: `Successfully linked "${thread.clean_title}" and created ${streamsToCreate.length} streams.` });

    } catch (error) {
        logger.error(error, 'Rescue operation failed.');
        res.status(500).json({ message: 'An internal error occurred during rescue.' });
    }
});

module.exports = router;
