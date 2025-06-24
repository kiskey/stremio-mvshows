// src/services/realdebrid.js
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

if (!config.isRdEnabled) {
    logger.info('Real-Debrid service is disabled: No API key provided.');
    module.exports = { isEnabled: false };
} else {
    const rdApi = axios.create({
        baseURL: 'https://api.real-debrid.com/rest/1.0',
        headers: { Authorization: `Bearer ${config.realDebridApiKey}` },
        timeout: 15000
    });

    async function addMagnet(magnet) {
        try {
            const response = await rdApi.post('/torrents/addMagnet', `magnet=${encodeURIComponent(magnet)}`);
            return response.data;
        } catch (error) {
            logger.error({ err: error.response ? error.response.data : error.message, magnet }, 'Failed to add magnet to Real-Debrid.');
            throw error;
        }
    }

    async function getTorrentInfo(id) {
        try {
            const response = await rdApi.get(`/torrents/info/${id}`);
            return response.data;
        } catch (error) {
            logger.error({ err: error.response ? error.response.data : error.message }, `Failed to get torrent info for ID: ${id}`);
            throw error;
        }
    }
    
    async function findTorrentByHash(infohash) {
        try {
            // This is a workaround as RD doesn't have a direct hash lookup in user's torrents
            const torrents = await rdApi.get('/torrents');
            return torrents.data.find(t => t.hash.toLowerCase() === infohash.toLowerCase());
        } catch(error) {
            logger.error({ err: error.message }, `Failed to search for torrent hash.`);
            return null;
        }
    }

    async function selectFiles(id, fileIds = 'all') {
        try {
            await rdApi.post(`/torrents/selectFiles/${id}`, `files=${fileIds}`);
            return true;
        } catch (error) {
            logger.error({ err: error.response ? error.response.data : error.message }, `Failed to select files for torrent ID: ${id}`);
            throw error;
        }
    }

    async function unrestrictLink(link) {
        try {
            const response = await rdApi.post('/unrestrict/link', `link=${link}`);
            return response.data;
        } catch (error) {
            logger.error({ err: error.response ? error.response.data : error.message }, `Failed to unrestrict link: ${link}`);
            throw error;
        }
    }

    module.exports = {
        isEnabled: true,
        addMagnet,
        getTorrentInfo,
        findTorrentByHash,
        selectFiles,
        unrestrictLink,
    };
}
