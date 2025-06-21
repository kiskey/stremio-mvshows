// src/api/stremio.routes.js
const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { models } = require('../database/connection');
const crud = require('../database/crud');
const { Op } = require('sequelize');
const logger = require('../utils/logger'); // Import logger for better debugging

// --- Quality Sorting Helper ---
const qualityOrder = { '4K': 1, '2160p': 1, '1080p': 2, '720p': 3, '480p': 4, 'SD': 5 };
const sortStreamsByQuality = (a, b) => {
    const qualityA = qualityOrder[a.quality] || 99;
    const qualityB = qualityOrder[b.quality] || 99;
    return qualityA - qualityB;
};

router.get('/manifest.json', (req, res) => {
    const manifest = {
        id: config.addonId,
        version: config.addonVersion,
        name: config.addonName,
        description: config.addonDescription,
        resources: ['catalog', 'stream'],
        types: ['series'], 
        idPrefixes: ['tt'], 
        catalogs: [{
            type: 'series',
            id: 'top-series-from-forum',
            name: 'Forum TV Shows',
            extra: [{ "name": "skip", "isRequired": false }]
        }],
        behaviorHints: { configurable: false, adult: false }
    };
    res.json(manifest);
});

// --- CORRECTED CATALOG HANDLER ---
router.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;
    let skip = 0;

    if (req.params.extra && req.params.extra.startsWith('skip=')) {
        skip = parseInt(req.params.extra.split('=')[1] || 0);
    }

    if (type !== 'series' || id !== 'top-series-from-forum') {
        return res.status(404).json({ err: 'Not Found' });
    }

    const limit = 100; // Stremio's typical page size, can be adjusted

    try {
        // FIX: The query now originates from the 'Thread' model, which represents our actual catalog entries.
        const threads = await models.Thread.findAll({
            where: {
                status: 'linked', // Only show threads that have been successfully linked to metadata
                tmdb_id: { [Op.ne]: null }
            },
            // Include the associated metadata from the other table
            include: [{
                model: models.TmdbMetadata,
                where: {
                    imdb_id: { [Op.ne]: null, [Op.startsWith]: 'tt' }
                },
                required: true // This makes it an INNER JOIN
            }],
            limit: limit,
            offset: skip,
            order: [['updatedAt', 'DESC']], // Order by the last time the thread was seen/updated
        });
        
        // Map the result to the Stremio meta object format
        const stremioMetas = threads.map(thread => {
            const tmdbData = thread.TmdbMetadata.data; // Access the joined data
            const parsedData = (typeof tmdbData === 'string') ? JSON.parse(tmdbData) : tmdbData;

            return {
                id: thread.TmdbMetadata.imdb_id, // Use the IMDb ID for Stremio
                type: 'series',
                name: thread.clean_title, // Use the title from the thread for more specificity (e.g., includes season)
                poster: parsedData.poster_path 
                    ? `https://image.tmdb.org/t/p/w500${parsedData.poster_path}`
                    : null,
            };
        });

        res.json({ metas: stremioMetas });

    } catch (error) {
        logger.error(error, "Failed to fetch catalog data.");
        res.status(500).json({ err: 'Internal Server Error' });
    }
});


router.get('/stream/:type/:id.json', async (req, res) => {
    if (req.params.type !== 'series') {
        return res.status(404).json({ streams: [] });
    }
    
    const [imdb_id, season, episode] = req.params.id.split(':');
    
    const meta = await models.TmdbMetadata.findOne({ where: { imdb_id }});
    if (!meta) { return res.status(404).json({ streams: [] }); }

    const streams = await crud.findStreams(meta.tmdb_id, season, episode);
    if (!streams || streams.length === 0) { return res.json({ streams: [] }); }
    
    streams.sort(sortStreamsByQuality);

    const streamList = streams.map(s => ({
        infoHash: s.infohash,
        name: `[TamilMV] - ${s.quality} 📺`,
        title: `S${String(s.season).padStart(2, '0')}E${String(s.episode).padStart(2, '0')} | ${s.language} 🎬\n${s.quality}`,
        sources: config.trackers
    }));

    res.json({ streams: streamList });
});

module.exports = router;
