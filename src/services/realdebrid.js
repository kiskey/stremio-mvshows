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

    async function selectFiles(id, fileIds = 'all') {
        try {
            // Returns 204 No Content on success, so we don't need the response data.
            await rdApi.post(`/torrents/selectFiles/${id}`, `files=${fileIds}`);
            return true;
        } catch (error) {
            // A 202 code means the action was already done, which is not an error for us.
            if (error.response && error.response.status === 202) {
                logger.warn(`Files for torrent ID ${id} were already selected.`);
                return true;
            }
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

    // NEW HELPER FUNCTION as per your approved plan
    async function addAndSelect(magnet) {
        try {
            const addResponse = await rdApi.post('/torrents/addMagnet', `magnet=${encodeURIComponent(magnet)}`);
            if (addResponse.data && addResponse.data.id) {
                const torrentId = addResponse.data.id;
                await selectFiles(torrentId, 'all');
                return await getTorrentInfo(torrentId);
            }
            return null;
        } catch (error) {
            logger.error({ err: error.response ? error.response.data : error.message }, `Failed during addAndSelect process.`);
            return null;
        }
    }

    module.exports = {
        isEnabled: true,
        addMagnet,
        getTorrentInfo,
        selectFiles,
        unrestrictLink,
        addAndSelect // Exporting the new function
    };
}
