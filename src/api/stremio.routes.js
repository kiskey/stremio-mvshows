// src/api/stremio.routes.js
const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { models } = require('../database/connection');
const crud = require('../database/crud');

router.get('/manifest.json', (req, res) => {
    const manifest = {
        id: config.addonId,
        version: config.addonVersion,
        name: config.addonName,
        description: config.addonDescription,
        resources: ['catalog', 'stream'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        catalogs: [
            { type: 'movie', id: 'top', name: 'Movies' },
            { type: 'series', id: 'top', name: 'Series' }
        ]
    };
    res.json(manifest);
});

router.get('/catalog/:type/:id.json', async (req, res) => {
    // This is a basic implementation; can be expanded.
    const metas = await models.TmdbMetadata.findAll({
        limit: 100,
        offset: parseInt(req.query.skip || 0),
        raw: true
    });
    
    const catalog = metas.map(meta => ({
        id: meta.imdb_id,
        type: meta.data.media_type,
        name: meta.data.name || meta.data.title,
        poster: `https://image.tmdb.org/t/p/w500${meta.data.poster_path}`
    }));

    res.json({ metas: catalog });
});

router.get('/stream/:type/:id.json', async (req, res) => {
    const [imdb_id, season, episode] = req.params.id.split(':');
    
    const meta = await models.TmdbMetadata.findOne({ where: { imdb_id }});
    if (!meta) {
        return res.status(404).json({ streams: [] });
    }

    const streams = await crud.findStreams(meta.tmdb_id, season, episode);
    if (!streams || streams.length === 0) {
        return res.json({ streams: [] });
    }

    const streamList = streams.map(s => ({
        infoHash: s.infohash,
        name: `${s.quality} | ${s.language}`,
        title: `${s.quality} | ${s.language}`,
        sources: config.trackers.map(t => `tracker:${t}`)
    }));

    res.json({ streams: streamList });
});

module.exports = router;
