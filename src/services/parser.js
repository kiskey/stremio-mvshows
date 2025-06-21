// src/services/parser.js
const ptt = require('parse-torrent-title');
const logger = require('../utils/logger');

/**
 * Expands a numeric range from a string, handling multiple formats.
 * e.g., "01-22" or "(01-22)" or "17-20"
 * @param {string} rangeStr The string containing the range.
 * @returns {number[]} An array of numbers.
 */
function expandEpisodeRange(rangeStr) {
    const match = rangeStr.match(/(\d{1,3})[–-]\s*(\d{1,3})/);
    if (!match) return [];
    
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    const episodes = [];

    if (!isNaN(start) && !isNaN(end) && end >= start) {
        for (let i = start; i <= end; i++) {
            episodes.push(i);
        }
    }
    return episodes;
}

/**
 * Parses a thread title using PTT after cleaning it.
 * @param {string} rawTitle The raw title from the forum.
 * @returns {object|null} An object with { clean_title, year } or null.
 */
function parseTitle(rawTitle) {
    const cleanedForPtt = rawTitle
        .replace(/By\s[\w\s.-]+,.*$/i, '')
        .trim();

    const pttResult = ptt.parse(cleanedForPtt);

    if (pttResult.title && pttResult.year) {
        logger.info({ ptt_result: pttResult }, `PTT successfully parsed title: ${rawTitle}`);
        return { clean_title: pttResult.title, year: pttResult.year };
    }
    
    logger.error(`PTT parsing failed for title: "${rawTitle}"`);
    return null;
}

/**
 * Parses a magnet URI's 'dn' parameter to extract stream metadata.
 * @param {string} magnetUri The full magnet URI.
 * @returns {object|null} An object with stream metadata or null.
 */
function parseMagnet(magnetUri) {
    try {
        const params = new URLSearchParams(magnetUri.split('?')[1]);
        const infohash = params.get('xt')?.replace('urn:btih:', '');
        
        let filename = params.get('dn') || '';
        if (!filename) {
            logger.warn({ magnetUri }, 'Magnet URI missing display name (dn parameter).');
            return null;
        }

        filename = decodeURIComponent(filename);

        // FIX: Pre-clean the filename by removing the leading domain.
        const cleanedFilename = filename.replace(/^www\.\w+\.\w+\s*-\s*/, '').trim();

        const pttResult = ptt.parse(cleanedFilename);
        
        let episodes = [];
        
        // Regex for Episode Ranges: EP (01-22), EP(01-06), EP 17-20
        const rangeMatch = cleanedFilename.match(/EP\s?\(?(\d{1,3}[–-]\d{1,3})\)?/i);

        if (rangeMatch && rangeMatch[1]) {
            episodes = expandEpisodeRange(rangeMatch[1]);
            if (episodes.length > 0) {
                 logger.info({ range: rangeMatch[1], count: episodes.length }, `Expanded episode range.`);
            }
        } else if (pttResult.episode) {
            episodes = [pttResult.episode];
        }

        if (!pttResult.season || episodes.length === 0) {
            logger.warn({ filename: cleanedFilename }, 'PTT failed to find required season/episode in magnet dn.');
            return null;
        }

        return {
            infohash,
            season: pttResult.season,
            episodes: episodes,
            quality: pttResult.resolution || 'SD',
            language: pttResult.language || 'multi',
        };
    } catch (e) {
        const shortMagnet = magnetUri.substring(0, 70);
        logger.error({ err: e, magnet: `${shortMagnet}...` }, `Magnet parsing failed`);
        return null;
    }
}

module.exports = { parseTitle, parseMagnet };
