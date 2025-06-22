// src/services/tracker.js
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

// In-memory cache for the tracker list
let cachedTrackers = [];

/**
 * Fetches the list of trackers from the configured URL and updates the cache.
 */
async function fetchAndCacheTrackers() {
    logger.info(`Fetching latest trackers from: ${config.trackerUrl}`);
    try {
        const response = await axios.get(config.trackerUrl, { timeout: 10000 });
        if (response.data) {
            // Split by newline and filter out any empty lines or comments
            const trackers = response.data
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));

            if (trackers.length > 0) {
                cachedTrackers = trackers;
                logger.info(`Successfully cached ${trackers.length} trackers.`);
            } else {
                logger.warn('Fetched tracker list was empty. Keeping old cache.');
            }
        }
    } catch (error) {
        logger.error({ err: error.message }, 'Failed to fetch tracker list. The addon will use the last known list (if any).');
    }
}

/**
 * Returns the current list of cached trackers.
 * @returns {string[]} An array of tracker URLs.
 */
function getTrackers() {
    return cachedTrackers;
}

module.exports = {
    fetchAndCacheTrackers,
    getTrackers,
};
