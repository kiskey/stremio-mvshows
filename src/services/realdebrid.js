// src/services/realdebrid.js
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

// This check ensures we don't even try to initialize if the key is missing.
if (!config.isRdEnabled) {
    logger.info('Real-Debrid service is disabled: No API key provided.');
    // Export dummy functions so the app doesn't crash on require()
    module.exports = { checkInstantAvailability: async () => ({}) };
} else {
    const rdApi = axios.create({
        baseURL: 'https://api.real-debrid.com/rest/1.0',
        headers: {
            Authorization: `Bearer ${config.realDebridApiKey}`
        },
        timeout: 15000 // Increased timeout for potentially large checks
    });

    /**
     * Checks if a chunk of torrents are instantly available on Real-Debrid servers.
     * @param {string[]} hashes - An array of infohashes (chunk).
     * @returns {Promise<Object>} An object where keys are infohashes and values are boolean.
     */
    async function checkInstantAvailability(hashes) {
        if (!hashes || hashes.length === 0) return {};
        
        const url = `/torrents/instantAvailability/${hashes.join('/')}`;
        try {
            const response = await rdApi.get(url);
            const availability = {};

            if (response.data) {
                for (const hash of hashes) {
                    const lowerHash = hash.toLowerCase();
                    // A hash is available if the response contains it (case-insensitively) 
                    // and it has at least one cached version in any of the 'rd' arrays.
                    availability[hash] = response.data[lowerHash] && 
                                         response.data[lowerHash].rd && 
                                         response.data[lowerHash].rd.length > 0;
                }
            }
            return availability;
        } catch (error) {
            const status = error.response ? error.response.status : 'N/A';
            logger.error({ err: error.message, status, url: '/torrents/instantAvailability/...' }, 'Real-Debrid instant availability check failed.');
            // Return an empty object on failure so the orchestrator can continue
            return {};
        }
    }

    // Future functions like addMagnet, getInfo, unrestrictLink would be added here.
    
    module.exports = {
        checkInstantAvailability
    };
}
