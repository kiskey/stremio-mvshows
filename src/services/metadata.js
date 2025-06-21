// src/services/metadata.js
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

const tmdbApi = axios.create({
    baseURL: 'https://api.themoviedb.org/3',
    params: { api_key: config.tmdbApiKey },
    timeout: 5000
});

const getTmdbMetadata = async (title, year) => {
    logger.debug(`Searching TMDB for: "${title}" (${year})`);
    
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

    logger.warn(`No TMDB match with year. Retrying with title only for: "${title}"`);
    try {
        const response = await tmdbApi.get('/search/multi', { params: { query: title } });
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

const getTmdbMetadataById = async (id) => {
    try {
        let result;
        if (id.startsWith('tt')) {
            logger.debug(`Looking up by IMDb ID: ${id}`);
            const findResponse = await tmdbApi.get(`/find/${id}`, { params: { external_source: 'imdb_id' } });
            result = findResponse.data.tv_results[0] || findResponse.data.movie_results[0];
        } else if (id.includes(':')) {
            const [type, tmdbId] = id.split(':');
            logger.debug(`Looking up by TMDB ID: ${tmdbId} (Type: ${type})`);
            if (type !== 'tv' && type !== 'movie') {
                logger.error(`Invalid type in manual ID: ${type}`); return null;
            }
            const findResponse = await tmdbApi.get(`/${type}/${tmdbId}`);
            result = findResponse.data;
        } else {
            logger.error(`Invalid manual ID format provided: ${id}. Must be 'tt...' or 'tv:...' or 'movie:...'.`);
            return null;
        }
        if (result) { return await formatTmdbData(result); }
    } catch (error) {
        logger.error({ err: error.message }, `TMDB API error during manual lookup for ID: ${id}`);
    }
    return null;
};

const formatTmdbData = async (tmdbResult) => {
    let imdb_id = null;
    const media_type = tmdbResult.media_type || (tmdbResult.first_air_date ? 'tv' : 'movie');

    try {
        const externalIdsResponse = await tmdbApi.get(`/${media_type}/${tmdbResult.id}/external_ids`);
        imdb_id = externalIdsResponse.data.imdb_id;
    } catch (e) {
        logger.warn(`Could not fetch external IDs for TMDB ID ${tmdbResult.id}.`);
    }

    const release_date = tmdbResult.release_date || tmdbResult.first_air_date;
    const year = release_date ? parseInt(release_date.substring(0, 4), 10) : null;

    return {
        dbEntry: {
            tmdb_id: tmdbResult.id.toString(),
            imdb_id: imdb_id,
            // FIX: Add the parsed year to the database entry
            year: year,
            data: {
                media_type: media_type,
                title: tmdbResult.title || tmdbResult.name,
                poster_path: tmdbResult.poster_path,
                backdrop_path: tmdbResult.backdrop_path,
                overview: tmdbResult.overview,
            },
        }
    };
};

module.exports = { getTmdbMetadata, getTmdbMetadataById };
