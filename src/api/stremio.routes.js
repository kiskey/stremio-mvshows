// src/api/stremio.routes.js
const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { models } = require('../database/connection');
const crud = require('../database/crud');
const rd = require('../services/realdebrid');
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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

router.get('/rd-poll/:streamId.json', async (req, res) => {
    const { streamId } = req.params;
    if (!rd.isEnabled || !streamId) {
        return res.status(404).send('Not Found');
    }

    try {
        const stream = await models.Stream.findByPk(streamId);
        if (!stream || !stream.rd_id) {
            return res.status(404).json({ error: 'Stream not found or not processing on RD.' });
        }

        for (let i = 0; i < 36; i++) { // Poll for up to 3 minutes
            const torrentInfo = await rd.getTorrentInfo(stream.rd_id);
            if (torrentInfo && torrentInfo.status === 'downloaded') {
                const largestFile = torrentInfo.files.sort((a,b) => b.bytes - a.bytes)[0];
                if (largestFile && largestFile.download_url) {
                    const unrestricted = await rd.unrestrictLink(largestFile.download_url);
                    await stream.update({ rd_status: 'downloaded', rd_link: unrestricted.download });
                    return res.redirect(302, unrestricted.download);
                }
            }
            await delay(5000); // Wait 5 seconds
        }
        await stream.update({ rd_status: 'error' });
        res.status(404).json({ error: 'Torrent timed out on Real-Debrid.' });
    } catch (error) {
        logger.error(error, `Polling failed for stream ID: ${streamId}`);
        res.status(500).json({ error: 'Polling failed.' });
    }
});

router.get('/stream/:type/:id.json', async (req, res) => {
    if (req.params.type !== 'series') {
        return res.status(404).json({ streams: [] });
    }
    
    const requestedId = req.params.id;
    let streamList = [];

    try {
        if (!config.isRdEnabled) {
            // --- P2P LOGIC (Real-Debrid Disabled) ---
            const [imdb_id, season, episode] = requestedId.split(':');
            const meta = await models.TmdbMetadata.findOne({ where: { imdb_id }});
            if (meta) {
                const dbStreams = await models.Stream.findAll({ where: { tmdb_id: meta.tmdb_id, season, episode: { [Op.lte]: episode }, episode_end: { [Op.gte]: episode } } });
                streamList = dbStreams.map(s => {
                    const seasonStr = String(s.season).padStart(2, '0');
                    let episodeStr;
                    if (!s.episode_end || s.episode_end === s.episode) episodeStr = `Episode ${String(s.episode).padStart(2, '0')}`;
                    else if (s.episode === 1 && s.episode_end === 999) episodeStr = 'Season Pack';
                    else episodeStr = `Episodes ${String(s.episode).padStart(2, '0')}-${String(s.episode_end).padStart(2, '0')}`;
                    return { infoHash: s.infohash, name: `[P2P] ${s.quality} 📺`, title: `S${seasonStr} | ${episodeStr}\n${s.quality || 'SD'} | ${s.language || 'N/A'}` };
                });
            }
        } else {
            // --- REAL-DEBRID LOGIC (Enabled) ---
            const [imdb_id, season, episode] = requestedId.split(':');
            const meta = await models.TmdbMetadata.findOne({ where: { imdb_id }});
            if (meta) {
                const candidateStreams = await models.Stream.findAll({ where: { tmdb_id: meta.tmdb_id, season, episode: { [Op.lte]: episode }, episode_end: { [Op.gte]: episode } } });
                for (const stream of candidateStreams) {
                    if (stream.rd_link) {
                        streamList.push({ name: `[RD+] ${stream.quality} ⚡️`, url: stream.rd_link, title: `S${season}E${episode}\nCached on Real-Debrid` });
                        continue;
                    }
                    const magnet = `magnet:?xt=urn:btih:${stream.infohash}`;
                    const rdResponse = await rd.addMagnet(magnet);
                    if (rdResponse.id) { // Magnet was added or was already there
                        await stream.update({ rd_id: rdResponse.id, rd_status: 'downloading' });
                        await rd.selectFiles(rdResponse.id);
                        streamList.push({ name: `[RD] ${stream.quality} ⏳`, url: `${config.appHost}/rd-poll/${stream.id}.json`, title: `S${season}E${episode}\nClick to download on Real-Debrid` });
                    }
                }
            }
        }

        if (streamList.length === 0) { return res.json({ streams: [] }); }
        
        streamList.sort(sortStreamsByQuality);

        const finalStreams = streamList.map(s => ({ ...s, sources: s.url ? undefined : [ `dht:${s.infoHash}`, ...getTrackers() ] }));
        const uniqueStreams = finalStreams.filter((stream, index, self) => index === self.findIndex((s) => (s.url || s.infoHash) === (stream.url || stream.infoHash)));

        res.json({ streams: uniqueStreams });

    } catch (error) {
        logger.error(error, `Failed to get streams for ID: ${requestedId}`);
        res.status(500).json({ streams: [] });
    }
});

module.exports = router;
