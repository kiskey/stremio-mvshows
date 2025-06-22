// src/api/stremio.routes.js
// ... (top part with quality sort and manifest is unchanged) ...

const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { models } = require('../database/connection');
const crud = require('../database/crud');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

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
        idPrefixes: ['tt', config.addonId],
        catalogs: [{
            type: 'series',
            id: 'top-series-from-forum',
            name: 'TamilMV Webseries',
            extra: [{ "name": "skip", "isRequired": false }]
        }],
        behaviorHints: { configurable: false, adult: false }
    };
    res.json(manifest);
});

// --- ENHANCED CATALOG HANDLER with custom pending metadata ---
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

    try {
        const linkedMetasPromise = models.TmdbMetadata.findAll({
            where: { imdb_id: { [Op.ne]: null, [Op.startsWith]: 'tt' } },
            order: [['year', 'DESC NULLS LAST'], ['updatedAt', 'DESC']],
            raw: true
        });

        const pendingThreadsPromise = models.Thread.findAll({
            where: { status: 'pending_tmdb' },
            order: [['updatedAt', 'DESC']],
        });

        const [linkedMetasRaw, pendingThreads] = await Promise.all([linkedMetasPromise, pendingThreadsPromise]);

        const linkedMetas = linkedMetasRaw.map(meta => {
            const parsedData = (typeof meta.data === 'string') ? JSON.parse(meta.data) : meta.data;
            return {
                id: meta.imdb_id,
                type: 'series',
                name: parsedData.title,
                poster: parsedData.poster_path ? `https://image.tmdb.org/t/p/w500${parsedData.poster_path}` : null,
            };
        });
        
        // FIX: Use the new custom metadata fields for pending items
        const pendingMetas = pendingThreads.map(thread => ({
            id: `${config.addonId}:${thread.id}`,
            type: 'series',
            name: `[PENDING] ${thread.clean_title}`,
            // Use the custom poster if it exists, otherwise the generic placeholder
            poster: thread.custom_poster || config.placeholderPoster, 
            // Use the custom description if it exists
            description: thread.custom_description || `This item is pending an official metadata match.`
        }));

        const allMetas = [...linkedMetas, ...pendingMetas];
        const paginatedMetas = allMetas.slice(skip, skip + limit);

        res.json({ metas: paginatedMetas });

    } catch (error) {
        logger.error(error, "Failed to fetch catalog data.");
        res.status(500).json({ err: 'Internal Server Error' });
    }
});


router.get('/stream/:type/:id.json', async (req, res) => {
    if (req.params.type !== 'series') {
        return res.status(404).json({ streams: [] });
    }
    
    const requestedId = req.params.id;
    let streams = [];
    let season, episode;

    try {
        if (requestedId.startsWith('tt')) {
            const [imdb_id_part, season_part, episode_part] = requestedId.split(':');
            season = season_part; episode = episode_part;
            const meta = await models.TmdbMetadata.findOne({ where: { imdb_id: imdb_id_part }});
            if (meta) {
                streams = await crud.findStreams(meta.tmdb_id, season, episode);
            }
        } else if (requestedId.startsWith(config.addonId)) {
            const [customIdPart, season_part, episode_part] = requestedId.split(':');
            season = season_part; episode = episode_part;
            const threadId = customIdPart.split(':')[1];
            const thread = await models.Thread.findByPk(threadId);
            if (thread && thread.status === 'pending_tmdb' && thread.magnet_uris) {
                for (const magnet_uri of thread.magnet_uris) {
                    const streamDetails = parser.parseMagnet(magnet_uri);
                    if (streamDetails && streamDetails.season == season && streamDetails.episodes.includes(parseInt(episode))) {
                        streams.push(streamDetails);
                    }
                }
            }
        }

        if (!streams || streams.length === 0) {
            return res.json({ streams: [] });
        }
        
        streams.sort(sortStreamsByQuality);

        const streamList = streams.map(s => ({
            infoHash: s.infohash,
            name: `[TamilMV] - ${s.quality} 📺`,
            title: `S${String(s.season).padStart(2, '0')}E${String(episode).padStart(2, '0')} | ${s.language} 🎬\n${s.quality}`,
            sources: config.trackers
        }));

        res.json({ streams: streamList });

    } catch (error) {
        logger.error(error, `Failed to get streams for ID: ${requestedId}`);
        res.status(500).json({ streams: [] });
    }
});

module.exports = router;
