// src/api/stremio.routes.js
const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { models } = require('../database/connection');
const crud = require('../database/crud');
const { Op } = require('sequelize');

// --- CORRECTED: Manifest now only supports series and uses IMDb IDs ---
router.get('/manifest.json', (req, res) => {
    const manifest = {
        id: config.addonId,
        version: config.addonVersion,
        name: config.addonName,
        description: config.addonDescription,
        resources: ['catalog', 'stream'],
        
        // We only provide TV Series
        types: ['series'], 
        
        // This tells Stremio that we will be sending IDs prefixed with 'tt' (IMDb)
        idPrefixes: ['tt'], 
        
        // Define the catalogs that will appear in Stremio's "Discover" section
        catalogs: [
            {
                type: 'series',
                id: 'top-series-from-forum', // A unique ID for your catalog
                name: 'Forum TV Shows'
            }
        ],
        // Optional hints for Stremio's UI
        behaviorHints: {
            configurable: false,
            adult: false,
        }
    };
    res.json(manifest);
});


// --- CORRECTED: Catalog handler now supports Stremio's pagination format ---
// This single route handles both the initial request and paginated requests
router.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;
    let skip = 0;

    // Stremio sends pagination info in the 'extra' URL part, like "skip=100"
    if (req.params.extra && req.params.extra.startsWith('skip=')) {
        skip = parseInt(req.params.extra.split('=')[1] || 0);
    }

    // Only respond if the request is for our declared catalog type and id
    if (type !== 'series' || id !== 'top-series-from-forum') {
        return res.status(404).json({ err: 'Not Found' });
    }

    const limit = 100; // Stremio's typical page size

    // Fetch the metadata from our database, using the pagination parameters
    const metas = await models.TmdbMetadata.findAll({
        where: {
            // Ensure we have a valid IMDb ID to provide to Stremio
            imdb_id: { [Op.ne]: null, [Op.startsWith]: 'tt' } 
        },
        limit: limit,
        offset: skip,
        order: [['createdAt', 'DESC']], // Or any other ordering you prefer
        raw: true
    });
    
    // Format the response for Stremio
    const stremioMetas = metas.map(meta => ({
        id: meta.imdb_id, // CRITICAL: Use the IMDb ID
        type: 'series',
        name: meta.data.title, // Get the name from our stored TMDB data blob
        poster: meta.data.poster_path 
            ? `https://image.tmdb.org/t/p/w500${meta.data.poster_path}`
            : null,
        // No need for descriptions, etc. Stremio gets them from Cinemata.
    }));

    res.json({ metas: stremioMetas });
});


// --- CORRECTED: Stream handler provides direct P2P torrent info ---
router.get('/stream/:type/:id.json', async (req, res) => {
    if (req.params.type !== 'series') {
        return res.status(404).json({ streams: [] });
    }
    
    // The ID from Stremio is in the format: "tt1234567:1:1" (imdb_id:season:episode)
    const [imdb_id, season, episode] = req.params.id.split(':');
    
    // 1. Bridge from IMDb ID back to our internal TMDB ID
    const meta = await models.TmdbMetadata.findOne({ where: { imdb_id }});
    if (!meta) {
        return res.status(404).json({ streams: [] });
    }

    // 2. Find all available streams for that episode using the internal TMDB ID
    const streams = await crud.findStreams(meta.tmdb_id, season, episode);
    if (!streams || streams.length === 0) {
        return res.json({ streams: [] });
    }

    // 3. Format the response according to Stremio's stream object documentation
    const streamList = streams.map(s => ({
        // The infoHash is the most important part for P2P streaming
        infoHash: s.infohash,
        
        // A user-friendly name for the stream in the UI
        name: `[${s.quality}] ${s.language}`,
        
        // A more detailed title that appears on hover
        title: `${s.quality} | ${s.language}\n💾 ${s.infohash}`,
        
        // CORRECTED: Provide the array of tracker URLs directly
        sources: config.trackers
    }));

    res.json({ streams: streamList });
});

module.exports = router;
