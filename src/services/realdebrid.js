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

    /**
     * Retrieves detailed information about a torrent from Real-Debrid.
     * @param {string} id - The Real-Debrid internal torrent ID.
     * @returns {Promise<object>} The full torrent info object.
     */
    async function getTorrentInfo(id) {
        try {
            const response = await rdApi.get(`/torrents/info/${id}`);
            return response.data;
        } catch (error) {
            logger.error({ err: error.response ? error.response.data : error.message }, `Failed to get torrent info for ID: ${id}`);
            throw error;
        }
    }
    
    /**
     * Adds a magnet and selects all files. Returns the RD torrent object.
     * @param {string} magnet - The magnet URI.
     * @returns {Promise<object|null>} The RD torrent object.
     */
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
        getTorrentInfo,
        addAndSelect
    };
}
