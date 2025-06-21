// src/api/stremio.routes.js
const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { models } = require('../database/connection');
const crud = require('../database/crud');
const { Op } = require('sequelize');

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
            name: 'Forum TV Shows'
        }],
        behaviorHints: { configurable: false, adult: false }
    };
    res.json(manifest);
});

router.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;
    let skip = 0;

    if (req.params.extra && req.params.extra.startsWith('skip=')) {
        skip = parseInt(req.params.extra.split('=')[1] || 0);
    }

    if (type !== 'series' || id !== 'top-series-from-forum') {
        return res.status(404).json({ err: 'Not Found' });
    }

    const limit = 100;
    const metas = await models.TmdbMetadata.findAll({
        where: {
            imdb_id: { [Op.ne]: null, [Op.startsWith]: 'tt' } 
        },
        limit: limit,
        offset: skip,
        order: [['createdAt', 'DESC']],
        raw: true
    });
    
    const stremioMetas = metas.map(meta => ({
        id: meta.imdb_id,
        type: 'series',
        name: meta.data.title,
        poster: meta.data.poster_path 
            ? `https://image.tmdb.org/t/p/w500${meta.data.poster_path}`
            : null,
    }));

    res.json({ metas: stremioMetas });
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
    
    // FIX: Sort streams by quality before sending the response
    streams.sort(sortStreamsByQuality);

    const streamList = streams.map(s => ({
        infoHash: s.infohash,
        // FIX: Re-format name and title as requested
        name: `[TamilMV] - ${s.quality} 📺`,
        title: `S${String(s.season).padStart(2, '0')}E${String(s.episode).padStart(2, '0')} | ${s.language} 🎬\n${s.quality}`,
        sources: config.trackers
    }));

    res.json({ streams: streamList });
});

module.exports = router;
