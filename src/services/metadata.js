// src/services/metadata.js
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

const tmdbApi = axios.create({
    baseURL: 'https://api.themoviedb.org/3',
    params: {
        api_key: config.tmdbApiKey,
    },
});

/**
 * Searches TMDB for a movie or TV show.
 * @param {string} title - The clean title of the show/movie.
 * @param {number} year - The release year.
 * @returns {Promise<Object|null>} - The formatted TMDB data or null if not found.
 */
const getTmdbMetadata = async (title, year) => {
    logger.debug(`Searching TMDB for: "${title}" (${year})`);
    
    // First attempt: Search with title and year for highest accuracy
    try {
        const response = await tmdbApi.get('/search/multi', {
            params: { query: title, first_air_date_year: year, year: year },
        });

        if (response.data && response.data.results.length > 0) {
            const result = response.data.results[0]; // Assume the first result is the best match
            logger.info(`TMDB match found for "${title}" with year: ${result.id}`);
            return formatTmdbData(result);
        }
    } catch (error) {
        logger.error({ err: error.message }, `TMDB API error during search with year for "${title}"`);
    }

    // Fallback: Search with title only if the first attempt fails
    logger.warn(`No TMDB match with year. Retrying with title only for: "${title}"`);
    try {
        const response = await tmdbApi.get('/search/multi', {
            params: { query: title },
        });

        if (response.data && response.data.results.length > 0) {
            const result = response.data.results[0];
            logger.info(`TMDB fallback match found for "${title}": ${result.id}`);
            return formatTmdbData(result);
        }
    } catch (error) {
        logger.error({ err: error.message }, `TMDB API error during fallback search for "${title}"`);
    }

    logger.error(`No TMDB match found for "${title}" after all attempts.`);
    return null;
};

/**
 * Formats the raw TMDB API response into the structure needed for our database.
 * @param {Object} tmdbResult - A single result object from the TMDB API.
 * @returns {Object} - An object containing the formatted data for storage.
 */
const formatTmdbData = (tmdbResult) => {
    // We need to fetch external IDs (like IMDb ID) separately for multi-search results
    // This step is simplified here, but in a full implementation, you'd make another
    // API call to the /movie/{id}/external_ids or /tv/{id}/external_ids endpoint.
    // For now, we'll assume the primary search is enough and handle IMDb ID if available.
    
    // Placeholder for IMDb ID logic. A real app would get this from another API call.
    const imdb_id = tmdbResult.imdb_id || `tt${tmdbResult.id}`; // A common but not guaranteed fallback

    return {
        // This is the data that will be stored in the TmdbMetadata table's `data` JSON blob
        rawData: tmdbResult, 
        
        // This is the formatted entry for direct insertion into the TmdbMetadata table
        dbEntry: {
            tmdb_id: tmdbResult.id.toString(),
            imdb_id: imdb_id, // This needs a proper lookup in a production app
            data: {
                media_type: tmdbResult.media_type,
                title: tmdbResult.title || tmdbResult.name,
                poster_path: tmdbResult.poster_path,
                // store other relevant data you might need for catalogs...
            },
        }
    };
};

module.exports = {
    getTmdbMetadata,
};
