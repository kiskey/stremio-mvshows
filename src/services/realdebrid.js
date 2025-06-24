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
     * Adds a magnet link to Real-Debrid for downloading.
     * @param {string} magnet - The full magnet URI.
     * @returns {Promise<object>} Response data from RD, or a custom object for already active torrents.
     */
    async function addMagnet(magnet) {
        try {
            const response = await rdApi.post('/torrents/addMagnet', `magnet=${encodeURIComponent(magnet)}`);
            return response.data; // Contains { id, uri }
        } catch (error) {
            if (error.response && error.response.data && error.response.data.error_code === 33) {
                logger.warn('Torrent is already active on Real-Debrid.');
                // We need the torrent ID to proceed, which is not in the error response.
                // This scenario requires listing all torrents to find the matching hash.
                // For simplicity, we'll treat it as a new download request that will quickly resolve.
                // A more advanced implementation could search the user's torrent list.
                return { isAlreadyActive: true, needsPolling: true };
            }
            logger.error({ err: error.message }, 'Failed to add magnet to Real-Debrid.');
            throw error;
        }
    }

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
            logger.error({ err: error.message }, `Failed to get torrent info for ID: ${id}`);
            throw error;
        }
    }

    /**
     * Tells Real-Debrid to start downloading selected files from a torrent.
     * @param {string} id - The Real-Debrid internal torrent ID.
     * @param {string} fileIds - A comma-separated string of file IDs, or "all".
     * @returns {Promise<boolean>} True on success.
     */
    async function selectFiles(id, fileIds = 'all') {
        try {
            await rdApi.post(`/torrents/selectFiles/${id}`, `files=${fileIds}`);
            return true;
        } catch (error) {
            logger.error({ err: error.message }, `Failed to select files for torrent ID: ${id}`);
            throw error;
        }
    }

    /**
     * Converts a hoster link from a downloaded torrent into a direct streaming link.
     * @param {string} link - The hoster link from the torrent info object.
     * @returns {Promise<object>} The unrestricted link object.
     */
    async function unrestrictLink(link) {
        try {
            const response = await rdApi.post('/unrestrict/link', `link=${link}`);
            return response.data; // Contains { download (the unrestricted link), filename, etc. }
        } catch (error) {
            logger.error({ err: error.message }, `Failed to unrestrict link: ${link}`);
            throw error;
        }
    }

    /**
     * Retrieves the user's current torrent list from Real-Debrid.
     * @returns {Promise<Array>} A list of torrent objects.
     */
    async function getTorrents() {
        try {
            const response = await rdApi.get('/torrents');
            return response.data;
        } catch (error) {
            logger.error({ err: error.message }, 'Failed to retrieve user torrent list.');
            return [];
        }
    }

    module.exports = {
        isEnabled: true,
        addMagnet,
        getTorrentInfo,
        selectFiles,
        unrestrictLink,
        getTorrents,
    };
}
