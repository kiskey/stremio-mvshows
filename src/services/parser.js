// src/services/parser.js
const ptt = require('parse-torrent-title');
const logger = require('../utils/logger');

/**
 * Expands a numeric range from a string.
 * e.g., "01-08" returns [1, 2, 3, 4, 5, 6, 7, 8]
 * @param {string} rangeStr The string range.
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
 * Attempts to parse a thread title using pre-cleaning, PTT, and regex fallbacks.
 * @param {string} rawTitle The raw title from the forum.
 * @returns {object|null} An object with { clean_title, year } or null.
 */
function parseTitle(rawTitle) {
    // 1. Pre-clean the title to remove common forum junk
    const cleanedForPtt = rawTitle
        .replace(/By\s[\w\s.]+,.*$/i, '') // Remove "By User, 13 hours ago..."
        .trim();

    // 2. Try PTT on the cleaned title
    const pttResult = ptt.parse(cleanedForPtt);

    if (pttResult.title && pttResult.year) {
        logger.info({ ptt_result: pttResult }, `PTT successfully parsed title: ${rawTitle}`);
        return { clean_title: pttResult.title, year: pttResult.year };
    }

    // 3. PTT Fallback Logic
    logger.warn(`PTT failed. Attempting regex fallback for: "${rawTitle}"`);
    let clean_title = null;
    let year = null;
    
    const yearMatch = rawTitle.match(/\b(20[0-2]\d)\b/); // More specific year range
    if (yearMatch) {
        year = parseInt(yearMatch[0], 10);
    }
    
    const titleMatch = rawTitle.match(/^(.+?)(?:\(\d{4}\))/);
    if (titleMatch) {
        clean_title = titleMatch[1].replace(/[._]/g, ' ').trim();
    }
    
    if (clean_title && year) {
        logger.info({ clean_title, year }, 'Regex fallback succeeded.');
        return { clean_title, year };
    }
    
    logger.error(`All parsing attempts failed for title: "${rawTitle}"`);
    return null;
}

/**
 * Parses magnet context or URI to extract stream metadata, including episode ranges.
 * @param {string} magnetUri The full magnet URI.
 * @param {string} contextText The text surrounding the magnet link.
 * @returns {object|null} An object with stream metadata or null.
 */
function parseMagnet(magnetUri, contextText) {
    try {
        const params = new URLSearchParams(magnetUri.split('?')[1]);
        const infohash = params.get('xt')?.replace('urn:btih:', '');
        if (!infohash) {
            logger.warn('Magnet URI missing infohash (xt parameter)');
            return null;
        }

        // Prioritize the contextual text from the page, fall back to magnet's display name (dn).
        const textToParse = contextText || params.get('dn') || '';
        
        const pttResult = ptt.parse(textToParse);
        
        let episodes = [];
        
        // Custom Regex for Episode Ranges, which PTT doesn't handle well.
        // Looks for patterns like EP (01-22), EP (01-06), EP(01-06), S02 EP (17-20)
        const rangeMatch = textToParse.match(/EP\s*\(?(\d{1,3}[–-]\d{1,3})\)?/i);

        if (rangeMatch && rangeMatch[1]) {
            episodes = expandEpisodeRange(rangeMatch[1]);
            logger.info({ range: rangeMatch[1], count: episodes.length }, `Expanded episode range from magnet text.`);
        } else if (pttResult.episode) {
            // Fallback to PTT's single episode result
            episodes = [pttResult.episode];
        }

        if (!pttResult.season || episodes.length === 0) {
            logger.warn({ textToParse }, 'PTT failed to find required season/episode in magnet text.');
            return null;
        }

        return {
            infohash,
            season: pttResult.season,
            episodes: episodes,
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
