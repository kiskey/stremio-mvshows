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
    
    // FIX: Implementing the missing function
    async function findTorrentByHash(infohash) {
        try {
            const torrents = await rdApi.get('/torrents');
            return torrents.data.find(t => t.hash.toLowerCase() === infohash.toLowerCase());
        } catch(error) {
            logger.error({ err: error.message }, `Failed to search user torrent list for hash.`);
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
    
    async function addAndSelect(magnet) {
        try {
            const addResponse = await rdApi.post('/torrents/addMagnet', `magnet=${encodeURIComponent(magnet)}`);
            if (addResponse.data && addResponse.data.id) {
                await rdApi.post(`/torrents/selectFiles/${addResponse.data.id}`, `files=all`);
                return await getTorrentInfo(addResponse.data.id);
            }
            return null;
        } catch (error) {
            logger.error({ err: error.response ? error.response.data : error.message }, `Failed to add/select magnet.`);
            return null;
        }
    }

    module.exports = {
        isEnabled: true,
        addMagnet,
        getTorrentInfo,
        findTorrentByHash, // FIX: Exporting the function
        selectFiles,
        unrestrictLink,
        addAndSelect
    };
}
