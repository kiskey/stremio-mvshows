// src/services/parser.js
const ptt = require('parse-torrent-title');
const logger = require('../utils/logger');

/**
 * Attempts to parse a thread title using ptt, with a regex fallback.
 * @param {string} rawTitle The raw title from the forum.
 * @returns {object|null} An object with { clean_title, year } or null.
 */
function parseTitle(rawTitle) {
    const pttResult = ptt.parse(rawTitle);

    if (pttResult.title && pttResult.year) {
        logger.info({ ptt_result: pttResult }, `PTT successfully parsed title: ${rawTitle}`);
        return { clean_title: pttResult.title, year: pttResult.year };
    }

    // --- PTT Fallback Logic ---
    logger.warn(`PTT failed to parse title and year. Attempting regex fallback for: "${rawTitle}"`);
    let clean_title = null;
    let year = null;
    
    // Regex to find a 4-digit year (1980-2049)
    const yearMatch = rawTitle.match(/\b(19[89]\d|20[0-4]\d)\b/);
    if (yearMatch) {
        year = parseInt(yearMatch[0], 10);
    }
    
    // Regex to get the title part, stopping at the year or common delimiters.
    // This captures everything from the start up to a year, a season indicator (S01), or quality tags.
    const titleMatch = rawTitle.match(/^(.+?)(?:\s\(?\d{4}\)?|\sS\d{2}|\s\d{3,4}p)/i);
    if (titleMatch) {
        // Clean up the matched title
        clean_title = titleMatch[1]
            .replace(/[._]/g, ' ') // Replace dots and underscores with spaces
            .replace(/\[.*?\]/g, '') // Remove content in square brackets
            .trim();
    }
    
    if (clean_title && year) {
        logger.info({ clean_title, year }, 'Regex fallback succeeded.');
        return { clean_title, year };
    }
    
    logger.error(`All parsing attempts failed for title: "${rawTitle}"`);
    return null;
}

/**
 * Parses a magnet link's display name (dn) to extract stream metadata.
 * @param {string} magnetUri The full magnet URI.
 * @returns {object|null} An object with stream metadata or null.
 */
function parseMagnet(magnetUri) {
    try {
        const params = new URLSearchParams(magnetUri.split('?')[1]);
        const infohash = params.get('xt')?.replace('urn:btih:', '');
        const filename = params.get('dn') || infohash;

        if (!infohash) {
            logger.warn('Magnet URI missing infohash (xt parameter)');
            return null;
        }

        const pttResult = ptt.parse(filename);

        // PTT is very good at this part, so we rely on it heavily.
        // We require at least a season and episode to proceed.
        if (!pttResult.season || !pttResult.episode) {
            logger.warn({ filename }, 'PTT failed to find season/episode in magnet name.');
            return null;
        }

        // PTT returns a single episode number. We can create an array for consistency.
        const episodes = [pttResult.episode];

        return {
            infohash,
            season: pttResult.season,
            episodes: episodes, // Handle single episode
            quality: pttResult.resolution || 'SD',
            language: pttResult.language || 'Unknown',
        };
    } catch (e) {
        const shortMagnet = magnetUri.substring(0, 70);
        logger.error({ err: e, magnet: `${shortMagnet}...` }, `Magnet parsing failed`);
        return null;
    }
}

module.exports = { parseTitle, parseMagnet };
