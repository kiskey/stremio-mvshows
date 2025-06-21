// src/services/metadata.js
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

const tmdbApi = axios.create({
    baseURL: 'https://api.themoviedb.org/3',
    params: {
        api_key: config.tmdbApiKey,
    },
    timeout: 5000 // 5-second timeout for API calls
});

/**
 * Searches TMDB for a movie or TV show by title and year.
 * @param {string} title - The clean title of the show/movie.
 * @param {number} year - The release year.
 * @returns {Promise<Object|null>} - The formatted TMDB data or null if not found.
 */
const getTmdbMetadata = async (title, year) => {
    logger.debug(`Searching TMDB for: "${title}" (${year})`);
    
    // Attempt 1: Search with title and year (highest accuracy)
    try {
        const response = await tmdbApi.get('/search/multi', {
            params: { query: title, first_air_date_year: year, year: year },
        });

        if (response.data && response.data.results.length > 0) {
            const result = response.data.results[0];
            logger.info(`TMDB primary match found for "${title}": (Type: ${result.media_type}, ID: ${result.id})`);
            return await formatTmdbData(result);
        }
    } catch (error) {
        logger.error({ err: error.message }, `TMDB API error on primary search for "${title}"`);
    }

    // Attempt 2: Fallback to title-only search
    logger.warn(`No TMDB match with year. Retrying with title only for: "${title}"`);
    try {
        const response = await tmdbApi.get('/search/multi', {
            params: { query: title },
        });

        if (response.data && response.data.results.length > 0) {
            const result = response.data.results[0];
            logger.info(`TMDB fallback match found for "${title}": (Type: ${result.media_type}, ID: ${result.id})`);
            return await formatTmdbData(result);
        }
    } catch (error) {
        logger.error({ err: error.message }, `TMDB API error on fallback search for "${title}"`);
    }

    logger.error(`No TMDB match found for "${title}" after all attempts.`);
    return null;
};

/**
 * Fetches TMDB data using a specific IMDb or TMDB ID.
 * @param {string} id - The ID string (e.g., "tt12345" or "tmdb:67890").
 * @returns {Promise<Object|null>}
 */
const getTmdbMetadataById = async (id) => {
    try {
        let result;
        if (id.startsWith('tt')) {
            logger.debug(`Looking up by IMDb ID: ${id}`);
            const findResponse = await tmdbApi.get(`/find/${id}`, { params: { external_source: 'imdb_id' } });
            result = findResponse.data.tv_results[0] || findResponse.data.movie_results[0];
        } else if (id.startsWith('tmdb:')) {
            const [type, tmdbId] = id.split(':');
            logger.debug(`Looking up by TMDB ID: ${tmdbId} (Type: ${type})`);
            if (type !== 'tv' && type !== 'movie') { throw new Error('Invalid type in tmdb:id'); }
            const findResponse = await tmdbApi.get(`/${type}/${tmdbId}`);
            result = findResponse.data;
        } else {
            logger.error(`Invalid manual ID format provided: ${id}`);
            return null;
        }

        if (result) {
            return await formatTmdbData(result);
        }
    } catch (error) {
        logger.error({ err: error.message }, `TMDB API error during manual lookup for ID: ${id}`);
    }
    return null;
};

/**
 * Takes a raw TMDB result and enriches it (e.g., gets IMDb ID) and formats for our DB.
 * @param {Object} tmdbResult - A single result object from the TMDB API.
 * @returns {Promise<Object>} - An object containing the formatted data for storage.
 */
const formatTmdbData = async (tmdbResult) => {
    let imdb_id = null;
    const media_type = tmdbResult.media_type || (tmdbResult.first_air_date ? 'tv' : 'movie');

    try {
        const externalIdsResponse = await tmdbApi.get(`/${media_type}/${tmdbResult.id}/external_ids`);
        imdb_id = externalIdsResponse.data.imdb_id;
    } catch (e) {
        logger.warn(`Could not fetch external IDs for TMDB ID ${tmdbResult.id}.`);
    }

    return {
        dbEntry: {
            tmdb_id: tmdbResult.id.toString(),
            imdb_id: imdb_id,
            data: { // This is the JSON blob stored in the database
                media_type: media_type,
                title: tmdbResult.title || tmdbResult.name,
                poster_path: tmdbResult.poster_path,
                backdrop_path: tmdbResult.backdrop_path,
                overview: tmdbResult.overview,
            },
        }
    };
};

module.exports = {
    getTmdbMetadata,
    getTmdbMetadataById,
};
