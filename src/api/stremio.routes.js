// src/api/stremio.routes.js
const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { models } = require('../database/connection');
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
        version: "10.0.0", // Final Stable Release
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

router.get('/rd-poll/:infohash/:episode.json', async (req, res) => {
    const { infohash, episode } = req.params;
    if (!rd.isEnabled || !infohash) return res.status(404).send('Not Found');

    try {
        const rdTorrent = await models.RdTorrent.findByPk(infohash);
        if (!rdTorrent || !rdTorrent.rd_id) {
            return res.status(404).json({ error: 'Torrent not being processed.' });
        }

        for (let i = 0; i < 36; i++) { // Poll for up to 3 minutes
            const torrentInfo = await rd.getTorrentInfo(rdTorrent.rd_id);
            if (torrentInfo && torrentInfo.status === 'downloaded') {
                logger.info({ torrentInfo }, `RD torrent ${rdTorrent.rd_id} finished downloading. Persisting file list and unrestricting links.`);
                await rdTorrent.update({ status: 'downloaded', files: torrentInfo.files, links: torrentInfo.links, last_checked: new Date() });

                let episodeFileIndex = -1;
                const episodeFile = torrentInfo.files.find((file, index) => {
                    const epMatch = file.path.match(/[Ee](\d{1,3})/);
                    const found = epMatch && parseInt(epMatch[1]) === parseInt(episode);
                    if (found) episodeFileIndex = index;
                    return found;
                });

                if (episodeFile && episodeFileIndex !== -1 && torrentInfo.links[episodeFileIndex]) {
                    const linkToUnrestrict = torrentInfo.links[episodeFileIndex];
                    logger.info({ message: 'Found matching file for requested episode.', episode, file: episodeFile.path, link: linkToUnrestrict });
                    const unrestricted = await rd.unrestrictLink(linkToUnrestrict);
                    return res.redirect(302, unrestricted.download);
                } else {
                    logger.error({ torrentInfo, episode }, 'Could not find matching file or link for downloaded torrent.');
                    break;
                }
            }
            await delay(5000);
        }
        await rdTorrent.update({ status: 'error' });
        res.status(404).json({ error: 'Torrent timed out on Real-Debrid.' });
    } catch (error) {
        logger.error(error, `Polling failed for infohash: ${infohash}`);
        res.status(500).json({ error: 'Polling failed.' });
    }
});


router.get('/rd-add/:infohash/:episode.json', async (req, res) => {
    const { infohash, episode } = req.params;
    if (!rd.isEnabled) return res.status(404).send('Not Found');
    
    try {
        const existingRdTorrent = await models.RdTorrent.findByPk(infohash);
        if (existingRdTorrent) {
            return res.redirect(`/rd-poll/${infohash}/${episode}.json`);
        }

        const magnet = `magnet:?xt=urn:btih:${infohash}`;
        const rdResponse = await rd.addMagnet(magnet);
        
        if (rdResponse && rdResponse.id) {
            await models.RdTorrent.create({
                infohash: infohash,
                rd_id: rdResponse.id,
                status: 'downloading'
            });
            await rd.selectFiles(rdResponse.id);
            res.redirect(`/rd-poll/${infohash}/${episode}.json`);
        } else {
            res.status(503).json({ error: 'Could not add torrent to Real-Debrid.' });
        }
    } catch (error) {
        logger.error(error, `Failed to add infohash ${infohash} to RD.`);
        res.status(500).json({ error: 'Could not add torrent to Real-Debrid.' });
    }
});


router.get('/stream/:type/:id.json', async (req, res) => {
    if (req.params.type !== 'series') {
        return res.status(404).json({ streams: [] });
    }
    
    const requestedId = req.params.id;
    let finalStreams = [];

    try {
        if (requestedId.startsWith('tt')) {
            const [imdb_id, season, episode] = requestedId.split(':');
            const meta = await models.TmdbMetadata.findOne({ where: { imdb_id }});
            if (!meta) return res.json({ streams: [] });

            const dbStreams = await models.Stream.findAll({
                where: { tmdb_id: meta.tmdb_id, season, episode: { [Op.lte]: episode }, episode_end: { [Op.gte]: episode } }
            });

            if (rd.isEnabled) {
                for (const stream of dbStreams) {
                    const seasonStr = String(stream.season).padStart(2, '0');
                    let episodeStr;
                    if (!stream.episode_end || stream.episode_end === stream.episode) episodeStr = `Episode ${String(stream.episode).padStart(2, '0')}`;
                    else if (stream.episode === 1 && stream.episode_end === 999) episodeStr = 'Season Pack';
                    else episodeStr = `Episodes ${String(stream.episode).padStart(2, '0')}-${String(stream.episode_end).padStart(2, '0')}`;
                    
                    const rdTorrent = await models.RdTorrent.findByPk(stream.infohash);

                    if (rdTorrent && rdTorrent.status === 'downloaded' && rdTorrent.files && rdTorrent.links) {
                        logger.info({ message: "Found downloaded torrent in local DB. Parsing persisted file list.", infohash: stream.infohash, files: rdTorrent.files });
                        
                        let episodeFileIndex = -1;
                        const episodeFile = rdTorrent.files.find((file, index) => {
                            const epMatch = file.path.match(/[Ee](\d{1,3})/);
                            const found = epMatch && parseInt(epMatch[1]) === parseInt(episode);
                            if (found) episodeFileIndex = index;
                            return found;
                        });

                        if (episodeFile && episodeFileIndex !== -1 && rdTorrent.links[episodeFileIndex]) {
                            const linkToUnrestrict = rdTorrent.links[episodeFileIndex];
                            logger.info({ message: 'Found matching file for instant playback.', requestedEpisode: episode, foundFile: episodeFile.path, linkToUnrestrict });
                            const unrestricted = await rd.unrestrictLink(linkToUnrestrict);
                            finalStreams.push({ name: `[RD+] ${stream.quality} ⚡️`, url: unrestricted.download, title: `S${seasonStr} | ${episodeStr}\n${episodeFile.path.substring(1)}`, quality: stream.quality });
                        } else {
                            logger.warn({ requestedEpisode: episode, files: rdTorrent.files }, 'File for requested episode not found in downloaded torrent, offering re-download.');
                            finalStreams.push({ name: `[RD] ${stream.quality} ⏳`, url: `${config.appHost}/rd-add/${stream.infohash}/${episode}.json`, title: `S${seasonStr} | ${episodeStr}\nFile not found, click to re-process`, quality: stream.quality });
                        }
                    } else {
                        finalStreams.push({ name: `[RD] ${stream.quality} ⏳`, url: `${config.appHost}/rd-add/${stream.infohash}/${episode}.json`, title: `S${seasonStr} | ${episodeStr}\nClick to Download to Real-Debrid`, quality: stream.quality });
                    }
                }
            } else {
                finalStreams = dbStreams.map(s => {
                    const seasonStr = String(s.season).padStart(2, '0');
                    let episodeStr;
                    if (!s.episode_end || s.episode_end === s.episode) episodeStr = `Episode ${String(s.episode).padStart(2, '0')}`;
                    else if (s.episode === 1 && s.episode_end === 999) episodeStr = 'Season Pack';
                    else episodeStr = `Episodes ${String(s.episode).padStart(2, '0')}-${String(s.episode_end).padStart(2, '0')}`;
                    
                    return { infoHash: s.infohash, name: `[TamilMV - P2P] - ${s.quality || 'SD'} 📺`, title: `S${seasonStr} | ${episodeStr}\n${s.quality || 'SD'} | ${s.language || 'N/A'}`, quality: s.quality };
                });
            }
        } else if (requestedId.startsWith(config.addonId)) {
            const idParts = requestedId.split(':');
            const threadId = idParts[1];
            if (threadId) {
                const thread = await models.Thread.findByPk(threadId);
                if (thread && thread.status === 'pending_tmdb' && thread.magnet_uris) {
                    for (const magnet_uri of thread.magnet_uris) {
                        const parsed = parser.parseMagnet(magnet_uri);
                        if (!parsed) continue;
                        const seasonStr = String(parsed.season).padStart(2, '0');
                        let episodeStr;
                        if (parsed.type === 'SEASON_PACK') episodeStr = 'Season Pack';
                        else if (parsed.type === 'EPISODE_PACK') episodeStr = `Episodes ${String(parsed.episodeStart).padStart(2, '0')}-${String(parsed.episodeEnd).padStart(2, '0')}`;
                        else episodeStr = `Episode ${String(parsed.episode).padStart(2, '0')}`;
                        
                        finalStreams.push({
                            infoHash: parsed.infohash,
                            name: `[TamilMV - P2P] - ${parsed.quality || 'SD'} 📺`,
                            title: `S${seasonStr} | ${episodeStr}\n${parsed.quality || 'SD'}`,
                            quality: parsed.quality
                        });
                    }
                }
            }
        }

        if (finalStreams.length === 0) return res.json({ streams: [] });
        
        finalStreams.sort(sortStreamsByQuality);

        const uniqueStreams = finalStreams.filter((stream, index, self) => 
            index === self.findIndex((s) => (s.url || s.infoHash) === (stream.url || stream.infoHash))
        ).map(s => ({ ...s, sources: s.url ? undefined : [ `dht:${s.infoHash}`, ...getTrackers() ] }));

        res.json({ streams: uniqueStreams });

    } catch (error) {
        logger.error(error, `Failed to get streams for ID: ${requestedId}`);
        res.status(500).json({ streams: [], error: error.message });
    }
});

module.exports = router;
