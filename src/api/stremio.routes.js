// src/api/stremio.routes.js
const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { models } = require('../database/connection');
const crud = require('../database/crud');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const parser = require('../services/parser');
const { getTrackers } = require('../services/tracker');

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
        resources: ['catalog', 'stream', 'meta'], 
        types: ['series'], 
        idPrefixes: ['tt', config.addonId], 
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
                id: meta.imdb_id, type: 'series', name: parsedData.title,
                poster: parsedData.poster_path ? `https://image.tmdb.org/t/p/w500${parsedData.poster_path}` : null,
            };
        });
        const pendingMetas = pendingThreads.map(thread => ({
            id: `${config.addonId}:${thread.id}`, type: 'series', name: `[PENDING] ${thread.clean_title}`,
            poster: thread.custom_poster || config.placeholderPoster,
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

router.get('/meta/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    if (type !== 'series' || !id.startsWith(config.addonId)) {
        return res.status(404).json({ err: 'Not Found' });
    }
    try {
        const threadId = id.split(':')[1];
        const thread = await models.Thread.findByPk(threadId);
        if (!thread || thread.status !== 'pending_tmdb') {
            return res.status(404).json({ err: 'Pending item not found' });
        }
        const metaObject = {
            id: id, type: 'series', name: thread.clean_title,
            poster: thread.custom_poster || config.placeholderPoster,
            description: thread.custom_description || 'Metadata is pending for this item. Streams may be available.',
            releaseInfo: thread.year ? thread.year.toString() : '',
        };
        res.json({ meta: metaObject });
    } catch (error) {
        logger.error(error, `Failed to fetch meta for ID: ${id}`);
        res.status(500).json({ err: 'Internal Server Error' });
    }
});

router.get('/stream/:type/:id.json', async (req, res) => {
    if (req.params.type !== 'series') {
        return res.status(404).json({ streams: [] });
    }
    
    const requestedId = req.params.id;
    let streams = [];

    try {
        if (requestedId.startsWith('tt')) {
            const [imdb_id, season, episode] = requestedId.split(':');
            const meta = await models.TmdbMetadata.findOne({ where: { imdb_id }});
            if (meta) {
                const queryOptions = {
                    where: {
                        tmdb_id: meta.tmdb_id,
                        season: season,
                        episode: { [Op.lte]: episode },
                        episode_end: { [Op.gte]: episode }
                    },
                    include: config.isRdEnabled ? [{ model: models.Hash, attributes: ['is_rd_cached'], required: false }] : []
                };
                streams = await models.Stream.findAll(queryOptions);
            }
        } else if (requestedId.startsWith(config.addonId)) {
            const idParts = requestedId.split(':');
            const threadId = idParts[1];
            // If the request is for the meta page, season and episode are not present
            if (idParts.length === 2 && threadId) {
                const thread = await models.Thread.findByPk(threadId);
                if (thread && thread.status === 'pending_tmdb' && thread.magnet_uris) {
                    for (const magnet_uri of thread.magnet_uris) {
                        const parsed = parser.parseMagnet(magnet_uri);
                        if (!parsed) continue;

                        streams.push(parsed); // Add the raw parsed data
                    }
                }
            }
        }

        if (streams.length === 0) {
            return res.json({ streams: [] });
        }
        
        streams.sort(sortStreamsByQuality);

        let streamList = streams.map(s => {
             // Handle raw parsed data for pending items
            if (!s.toStreamObject) {
                let title;
                if (s.type === 'SEASON_PACK') title = `[PENDING] Season ${String(s.season).padStart(2, '0')} Pack`;
                else if (s.type === 'EPISODE_PACK') title = `[PENDING] S${String(s.season).padStart(2, '0')} (E${s.episodeStart}-${s.episodeEnd})`;
                else title = `[PENDING] S${String(s.season).padStart(2, '0')}E${String(s.episode).padStart(2, '0')}`;
                return {
                    infoHash: s.infohash,
                    name: `[TamilMV] ${s.quality || 'SD'} 📺`,
                    title: title
                };
            }
            // Handle Sequelize model instances for linked items
            return s.toStreamObject();
        });

        // Add DHT and trackers to all stream objects
        const trackers = getTrackers();
        streamList = streamList.map(s => ({
            ...s,
            sources: [ `dht:${s.infoHash}`, ...trackers ]
        }));

        const uniqueStreams = streamList.filter((stream, index, self) =>
            index === self.findIndex((s) => s.infoHash === stream.infoHash && s.title === stream.title)
        );

        res.json({ streams: uniqueStreams });

    } catch (error) {
        logger.error(error, `Failed to get streams for ID: ${requestedId}`);
        res.status(500).json({ streams: [] });
    }
});

module.exports = router;
