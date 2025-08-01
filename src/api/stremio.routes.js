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
const ptt = require('parse-torrent-title');
const { getTmdbEpisodeData } = require('../services/metadata');

const qualityOrder = { '4K': 1, '2160p': 1, '1080p': 2, '720p': 3, '480p': 4, 'SD': 5 };
const sortStreamsByQuality = (a, b) => {
    const qualityA = qualityOrder[a.quality] || 99;
    const qualityB = qualityOrder[b.quality] || 99;
    return qualityA - qualityB;
};

router.get('/manifest.json', (req, res) => {
    const manifest = {
        id: config.addonId,
        version: "12.0.0",
        name: config.addonName,
        description: config.addonDescription,
        resources: ['catalog', 'stream', 'meta'],
        types: ['series', 'movie'],
        idPrefixes: [config.addonId, 'tt'], 
        catalogs: [
            { type: 'series', id: 'top-series-from-forum', name: 'Tamil Webseries', extra: [{ "name": "skip", "isRequired": false }] },
            { type: 'movie', id: 'tamil-hd-movies', name: 'Tamil HD Movies', extra: [{ "name": "skip", "isRequired": false }] },
            { type: 'movie', id: 'tamil-dubbed-movies', name: 'Tamil HD Dubbed Movies', extra: [{ "name": "skip", "isRequired": false }] }
        ],
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
    
    if (type === 'series' && id === 'top-series-from-forum') {
        return getSeriesCatalog(req, res, skip);
    }
    if (type === 'movie' && (id === 'tamil-hd-movies' || id === 'tamil-dubbed-movies')) {
        return getMovieCatalog(req, res, skip, id);
    }
    
    return res.status(404).json({ err: 'Not Found' });
});

async function getSeriesCatalog(req, res, skip) {
    const limit = 100;
    try {
        const allThreads = await models.Thread.findAll({
            where: { type: 'series' },
            include: [{ model: models.TmdbMetadata, required: false }],
            order: [[models.TmdbMetadata, 'year', 'DESC'], ['updatedAt', 'DESC']],
            offset: skip,
            limit: limit
        });
        const metas = allThreads.map(thread => {
            if (thread.status === 'linked' && thread.TmdbMetadatum) {
                const meta = thread.TmdbMetadatum;
                const parsedData = (typeof meta.data === 'string') ? JSON.parse(meta.data) : meta.data;
                return { id: `${config.addonId}:${meta.imdb_id}`, type: 'series', name: parsedData.title, poster: parsedData.poster_path ? `https://image.tmdb.org/t/p/w500${parsedData.poster_path}` : null, };
            } else if (thread.status === 'pending_tmdb') {
                 return { id: `${config.addonId}:pending:${thread.id}`, type: 'series', name: `[PENDING] ${thread.clean_title}`, poster: thread.custom_poster || config.placeholderPoster, description: thread.custom_description || `This item is pending an official metadata match.` };
            }
            return null;
        }).filter(meta => meta);
        res.json({ metas });
    } catch (error) {
        logger.error(error, "Failed to fetch series catalog data.");
        res.status(500).json({ err: 'Internal Server Error' });
    }
}

async function getMovieCatalog(req, res, skip, catalogId) {
    const limit = 100;
    try {
        const allThreads = await models.Thread.findAll({
            where: { type: 'movie', catalog: catalogId },
            include: [{ model: models.TmdbMetadata, required: true }],
            order: [['postedAt', 'DESC']],
            offset: skip,
            limit: limit
        });
        const metas = allThreads.map(thread => {
            const meta = thread.TmdbMetadatum;
            const parsedData = (typeof meta.data === 'string') ? JSON.parse(meta.data) : meta.data;
            return {
                id: `${config.addonId}:${meta.imdb_id}`,
                type: 'movie',
                name: parsedData.title,
                poster: parsedData.poster_path ? `https://image.tmdb.org/t/p/w500${parsedData.poster_path}` : null,
            };
        });
        res.json({ metas });
    } catch (error) {
        logger.error(error, "Failed to fetch movie catalog data.");
        res.status(500).json({ err: 'Internal Server Error' });
    }
}

router.get('/meta/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    if ((type !== 'series' && type !== 'movie') || !id.startsWith(config.addonId)) {
        return res.status(404).json({ err: 'Not Found' });
    }

    try {
        const idParts = id.split(':');
        const itemTypeOrImdbId = idParts[1];

        if (itemTypeOrImdbId === 'pending') {
            const threadId = idParts[2];
            const thread = await models.Thread.findByPk(threadId);
            if (!thread || thread.status !== 'pending_tmdb') return res.status(404).json({ err: 'Pending item not found' });
            return res.json({ meta: { id: id, type: thread.type, name: thread.clean_title, poster: thread.custom_poster || config.placeholderPoster, description: thread.custom_description || 'Metadata is pending.', releaseInfo: thread.year ? thread.year.toString() : '' } });
        }

        if (itemTypeOrImdbId.startsWith('tt')) {
            const imdb_id = itemTypeOrImdbId;
            const metaRecord = await models.TmdbMetadata.findOne({ where: { imdb_id: imdb_id } });
            if (!metaRecord) return res.status(404).json({ err: 'Metadata not found in local database.' });

            const tmdbData = (typeof metaRecord.data === 'string') ? JSON.parse(metaRecord.data) : metaRecord.data;
            const metaObject = {
                id: id, type: tmdbData.media_type, name: tmdbData.title,
                poster: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : null,
                background: tmdbData.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdbData.backdrop_path}` : null,
                description: tmdbData.overview,
                releaseInfo: metaRecord.year ? metaRecord.year.toString() : '',
                year: metaRecord.year
            };

            if (tmdbData.media_type === 'series') {
                const streams = await models.Stream.findAll({
                    where: { tmdb_id: metaRecord.tmdb_id },
                    attributes: ['season', 'episode', 'episode_end'],
                    order: [['season', 'ASC'], ['episode', 'ASC']],
                    raw: true,
                });
                const uniqueSeasonNumbers = [...new Set(streams.map(s => s.season))];
                const episodeDataPromises = uniqueSeasonNumbers.map(seasonNum => getTmdbEpisodeData(metaRecord.tmdb_id, seasonNum));
                const seasonsData = await Promise.all(episodeDataPromises);
                const episodeDataMap = new Map();
                seasonsData.flat().forEach(ep => episodeDataMap.set(`s${ep.season_number}e${ep.episode_number}`, ep));

                const videos = [];
                const uniqueEpisodes = new Set();
                for (const s of streams) {
                    const episodeStart = s.episode;
                    const episodeEnd = (s.episode_end && s.episode_end > episodeStart) ? s.episode_end : episodeStart;
                    for (let epNum = episodeStart; epNum <= episodeEnd; epNum++) {
                        const uniqueKey = `s${s.season}e${epNum}`;
                        if (uniqueEpisodes.has(uniqueKey)) continue;
                        const richEpisodeData = episodeDataMap.get(uniqueKey);
                        videos.push({
                            season: s.season, episode: epNum, id: `${id}:${s.season}:${epNum}`,
                            title: richEpisodeData?.name || `Episode ${epNum}`,
                            released: richEpisodeData?.air_date ? new Date(richEpisodeData.air_date).toISOString() : new Date(metaRecord.year, s.season - 1, epNum).toISOString(),
                            thumbnail: richEpisodeData?.still_path ? `https://image.tmdb.org/t/p/w500${richEpisodeData.still_path}` : null,
                            overview: richEpisodeData?.overview || null,
                        });
                        uniqueEpisodes.add(uniqueKey);
                    }
                }
                metaObject.videos = videos;
            }

            return res.json({ meta: metaObject });
        }
        
        return res.status(404).json({ err: 'Invalid ID format' });
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
        const pollTimeout = 180000;
        const pollInterval = 5000;
        const startTime = Date.now();
        while (Date.now() - startTime < pollTimeout) {
            const torrentInfo = await rd.getTorrentInfo(rdTorrent.rd_id);
            if (torrentInfo && (torrentInfo.status === 'error' || torrentInfo.status === 'magnet_error')) {
                logger.warn({ torrentInfo }, `RD torrent ${rdTorrent.rd_id} entered a failed state.`);
                break;
            }
            if (torrentInfo && torrentInfo.status === 'waiting_files_selection') {
                logger.warn({ rd_id: torrentInfo.id }, "Torrent is waiting for file selection. Attempting to select all files to un-stick it.");
                await rd.selectFiles(torrentInfo.id);
            }
            if (torrentInfo && torrentInfo.status === 'downloaded') {
                await rdTorrent.update({ status: 'downloaded', files: torrentInfo.files, links: torrentInfo.links, last_checked: new Date() });
                
                logger.debug({
                    infohash,
                    requestedEpisode: episode,
                    filesJson: JSON.stringify(torrentInfo.files),
                    linksJson: JSON.stringify(torrentInfo.links)
                }, "Torrent downloaded. Analyzing file list for requested episode.");

                let episodeFile;
                let linkIndex = -1;
                
                const downloadableFiles = torrentInfo.files.filter(file => file.selected === 1);

                logger.debug("Attempting Layer 1 & 2: PTT and Regex parsing on downloadable files...");
                for (let i = 0; i < downloadableFiles.length; i++) {
                    const file = downloadableFiles[i];
                    const pttResult = ptt.parse(file.path);
                    let foundEpisode = pttResult.episode;

                    if (foundEpisode === undefined) {
                        const regex = /S(\d{1,2})\s*(?:E|EP|\s)\s*(\d{1,3})/i;
                        const match = file.path.match(regex);
                        if (match) {
                            foundEpisode = parseInt(match[2], 10);
                        }
                    }
                    
                    if (foundEpisode === parseInt(episode)) {
                        episodeFile = file;
                        linkIndex = i;
                        break;
                    }
                }
                
                if (!episodeFile) {
                    logger.warn({ infohash, episode }, "Layers 1 & 2 failed. Attempting Layer 3: Single-file heuristic...");
                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv'];
                    const videoFiles = downloadableFiles.filter(file => 
                        videoExtensions.some(ext => file.path.toLowerCase().endsWith(ext))
                    );

                    if (videoFiles.length === 1) {
                        logger.info({ infohash, file: videoFiles[0].path }, "Heuristic successful: Found a single video file. Selecting it.");
                        episodeFile = videoFiles[0];
                        linkIndex = downloadableFiles.findIndex(file => file.id === episodeFile.id);
                    }
                }
                
                if (episodeFile && linkIndex !== -1 && torrentInfo.links[linkIndex]) {
                    const unrestricted = await rd.unrestrictLink(torrentInfo.links[linkIndex]);
                    return res.redirect(302, unrestricted.download);
                } else {
                    logger.error({
                        infohash,
                        requestedEpisode: episode,
                        files: torrentInfo.files.map(f => f.path),
                        foundIndex: linkIndex,
                        linksCount: torrentInfo.links.length
                    }, "All matching attempts failed. Could not find a suitable file to stream.");
                    break;
                }
            }
            await delay(pollInterval);
        }
        await rdTorrent.update({ status: 'error' });
        res.status(404).json({ error: 'Torrent timed out or failed.' });
    } catch (error) {
        if (error instanceof rd.ResourceNotFoundError) {
            logger.warn({ infohash }, "Torrent disappeared from Real-Debrid during polling. Deleting stale local entry.");
            await models.RdTorrent.destroy({ where: { infohash } });
        }
        logger.error(error, `Polling failed for infohash: ${infohash}`);
        res.status(500).json({ error: 'Polling failed.' });
    }
});

router.head('/rd-add/:infohash/:episode.json', (req, res) => {
    res.status(200).end();
});

router.get('/rd-add/:infohash/:episode.json', async (req, res) => {
    const { infohash, episode } = req.params;
    if (!rd.isEnabled) return res.status(404).send('Not Found');

    const addAndProcess = async () => {
        const magnet = `magnet:?xt=urn:btih:${infohash}`;
        const rdResponse = await rd.addMagnet(magnet);
        if (rdResponse && rdResponse.id) {
            const rd_id = rdResponse.id;
            await models.RdTorrent.create({ infohash, rd_id, status: 'magnet_conversion' });

            let isReadyForSelection = false;
            const waitTimeout = 20000;
            const waitInterval = 2000;
            const waitStartTime = Date.now();

            while (Date.now() - waitStartTime < waitTimeout) {
                const torrentInfo = await rd.getTorrentInfo(rd_id);
                if (torrentInfo.status === 'waiting_files_selection') {
                    logger.info({ rd_id }, "Torrent is ready for file selection.");
                    isReadyForSelection = true;
                    break;
                }
                if (torrentInfo.status === 'error' || torrentInfo.status === 'magnet_error') {
                    throw new Error(`Real-Debrid failed to parse magnet: ${torrentInfo.status}`);
                }
                logger.debug({ rd_id, status: torrentInfo.status }, "Waiting for Real-Debrid to parse magnet...");
                await delay(waitInterval);
            }

            if (!isReadyForSelection) {
                throw new Error(`Torrent ${rd_id} was not ready for file selection in time.`);
            }

            await rd.selectFiles(rd_id);
            return res.redirect(`/rd-poll/${infohash}/${episode}.json`);
        } else {
            throw new Error('Could not add torrent to Real-Debrid after re-attempt.');
        }
    };

    try {
        const existingRdTorrent = await models.RdTorrent.findByPk(infohash);

        if (existingRdTorrent) {
            logger.info({ infohash, rd_id: existingRdTorrent.rd_id }, "Existing torrent found. Attempting to verify its status on RD.");
            try {
                await rd.getTorrentInfo(existingRdTorrent.rd_id);
                return res.redirect(`/rd-poll/${infohash}/${episode}.json`);
            } catch (error) {
                if (error instanceof rd.ResourceNotFoundError) {
                    logger.warn({ infohash, rd_id: existingRdTorrent.rd_id }, "Stale torrent found in DB. Deleting and re-adding.");
                    await existingRdTorrent.destroy();
                    return await addAndProcess();
                }
                throw error;
            }
        }

        await addAndProcess();
        
    } catch (error) {
        logger.error(error, `Critical failure during add process for infohash ${infohash}.`);
        res.status(500).json({ error: 'Could not process torrent on Real-Debrid.' });
    }
});

router.get('/stream/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    if (type !== 'series' && type !== 'movie') {
        return res.status(404).json({ streams: [] });
    }
    
    const requestedId = req.params.id;
    let finalStreams = [];

    try {
        let imdb_id, season, episode;

        if (requestedId.startsWith(config.addonId)) {
            const idParts = requestedId.split(':');
            const itemTypeOrImdbId = idParts[1];

            if (itemTypeOrImdbId === 'pending') {
                const threadId = idParts[2];
                const thread = await models.Thread.findByPk(threadId);
                if (thread && thread.status === 'pending_tmdb' && thread.magnet_uris) {
                    for (const magnet_uri of thread.magnet_uris) {
                        const parsed = parser.parseMagnet(magnet_uri, thread.type);
                        if (!parsed) continue;
                        if (thread.type === 'movie') {
                            finalStreams.push({ infoHash: parsed.infohash, name: `[P2P] ${parsed.quality || 'SD'} 📺`, title: `${thread.clean_title}\n${parsed.quality || 'SD'}`, quality: parsed.quality });
                        } else {
                            let episodeStr;
                            if (parsed.type === 'SEASON_PACK') episodeStr = 'Season Pack';
                            else if (parsed.type === 'EPISODE_PACK') episodeStr = `Episodes ${String(parsed.episodeStart).padStart(2, '0')}-${String(parsed.episodeEnd).padStart(2, '0')}`;
                            else episodeStr = `Episode ${String(parsed.episode).padStart(2, '0')}`;
                            finalStreams.push({ infoHash: parsed.infohash, name: `[P2P] ${parsed.quality || 'SD'} 📺`, title: `S${String(parsed.season).padStart(2, '0')} | ${episodeStr}\n${parsed.quality || 'SD'}`, quality: parsed.quality });
                        }
                    }
                }
            } else if (itemTypeOrImdbId.startsWith('tt')) {
                imdb_id = itemTypeOrImdbId;
                if (type === 'series' && idParts.length >= 4) {
                    season = idParts[2];
                    episode = idParts[3];
                }
            }
        } else if (requestedId.startsWith('tt')) {
            const idParts = requestedId.split(':');
            imdb_id = idParts[0];
            if (type === 'series' && idParts.length >= 3) {
                season = idParts[1];
                episode = idParts[2];
            }
        }

        if (imdb_id) {
            const meta = await models.TmdbMetadata.findOne({ where: { imdb_id }});
            if (!meta) return res.json({ streams: [] });

            const whereClause = { tmdb_id: meta.tmdb_id };
            if (type === 'series') {
                if (season && episode) { // Request is for a specific episode
                    whereClause.season = season;
                    whereClause.episode = { [Op.lte]: episode };
                    whereClause.episode_end = { [Op.gte]: episode };
                }
            } else if (type === 'movie') {
                whereClause.season = null;
                whereClause.episode = null;
            }
            const dbStreams = await models.Stream.findAll({ where: whereClause });

            if (rd.isEnabled) {
                 for (const stream of dbStreams) {
                    let titleDetail = '';
                    if (type === 'series') {
                        const seasonStr = String(stream.season).padStart(2, '0');
                        if (!stream.episode_end || stream.episode_end === stream.episode) titleDetail = `Episode ${String(stream.episode).padStart(2, '0')}`;
                        else if (stream.episode === 1 && stream.episode_end === 999) titleDetail = 'Season Pack';
                        else titleDetail = `Episodes ${String(stream.episode).padStart(2, '0')}-${String(stream.episode_end).padStart(2, '0')}`;
                        titleDetail = `S${seasonStr} | ${titleDetail}`;
                    } else {
                        const tmdbData = (typeof meta.data === 'string') ? JSON.parse(meta.data) : meta.data;
                        titleDetail = tmdbData.title;
                    }

                    const rdTorrent = await models.RdTorrent.findByPk(stream.infohash);
                    if (rdTorrent && rdTorrent.status === 'downloaded' && rdTorrent.files && rdTorrent.links) {
                        let fileToStream;
                        let linkIndex = -1;
                        const downloadableFiles = rdTorrent.files.filter(file => file.selected === 1);

                        if (type === 'movie') {
                            const videoExtensions = ['.mkv', '.mp4', '.avi'];
                            const videoFiles = downloadableFiles.filter(file => videoExtensions.some(ext => file.path.toLowerCase().endsWith(ext)));
                            if (videoFiles.length > 0) {
                                fileToStream = videoFiles.reduce((largest, current) => current.bytes > largest.bytes ? current : largest, videoFiles[0]);
                                linkIndex = downloadableFiles.findIndex(f => f.id === fileToStream.id);
                            }
                        } else {
                            for (let i = 0; i < downloadableFiles.length; i++) {
                                const file = downloadableFiles[i];
                                let foundEpisode;
                                const pttResult = ptt.parse(file.path);
                                foundEpisode = pttResult.episode;
                                if (foundEpisode === undefined) {
                                    const regex = /S(\d{1,2})\s*(?:E|EP|\s)\s*(\d{1,3})/i;
                                    const match = file.path.match(regex);
                                    if (match) foundEpisode = parseInt(match[2], 10);
                                }
                                if (foundEpisode === parseInt(episode)) {
                                    fileToStream = file;
                                    linkIndex = i;
                                    break;
                                }
                            }
                        }

                        if (fileToStream && linkIndex !== -1 && rdTorrent.links[linkIndex]) {
                            const unrestricted = await rd.unrestrictLink(rdTorrent.links[linkIndex]);
                            finalStreams.push({ name: `[RD+] ${stream.quality} ⚡️`, url: unrestricted.download, title: `${titleDetail}\n${fileToStream.path.substring(1)}`, quality: stream.quality });
                        } else {
                            finalStreams.push({ name: `[RD] ${stream.quality} ⏳`, url: `${config.appHost}/rd-add/${stream.infohash}/${episode || 1}.json`, title: `${titleDetail}\nFile not found`, quality: stream.quality });
                        }
                    } else {
                        finalStreams.push({ name: `[RD] ${stream.quality} ⏳`, url: `${config.appHost}/rd-add/${stream.infohash}/${episode || 1}.json`, title: `${titleDetail}\nClick to Download`, quality: stream.quality });
                    }
                }
            } else {
                 finalStreams = dbStreams.map(s => {
                    if (type === 'movie') {
                        return { infoHash: s.infohash, name: `[P2P] ${s.quality || 'SD'} 📺`, title: `${s.quality || 'SD'} | ${s.language || 'N/A'}`, quality: s.quality };
                    } else {
                        const seasonStr = String(s.season).padStart(2, '0');
                        let episodeStr;
                        if (!s.episode_end || s.episode_end === s.episode) episodeStr = `Episode ${String(s.episode).padStart(2, '0')}`;
                        else if (s.episode === 1 && s.episode_end === 999) episodeStr = 'Season Pack';
                        else episodeStr = `Episodes ${String(s.episode).padStart(2, '0')}-${String(s.episode_end).padStart(2, '0')}`;
                        return { infoHash: s.infohash, name: `[P2P] ${s.quality || 'SD'} 📺`, title: `S${seasonStr} | ${episodeStr}\n${s.quality || 'SD'} | ${s.language || 'N/A'}`, quality: s.quality };
                    }
                });
            }
        }

        if (finalStreams.length === 0) return res.json({ streams: [] });
        finalStreams.sort(sortStreamsByQuality);
        const uniqueStreams = finalStreams.filter((stream, index, self) => index === self.findIndex((s) => (s.url || s.infoHash) === (stream.url || stream.infoHash))).map(s => ({ ...s, sources: s.url ? undefined : [ `dht:${s.infoHash}`, ...getTrackers() ] }));
        res.json({ streams: uniqueStreams });
    } catch (error) {
        logger.error(error, `Failed to get streams for ID: ${requestedId}`);
        res.status(500).json({ streams: [], error: error.message });
    }
});

module.exports = router;
