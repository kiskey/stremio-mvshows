// src/services/parser.js
const ptt = require('parse-torrent-title');
const logger = require('../utils/logger');

// Regex patterns inspired by the provided example for maximum accuracy.
const PARSING_PATTERNS = [
    // Case 1: Full packs like S01EP(01-13) or S01 EP (01-15) or S01(E01-26)
    { regex: /S(\d{1,2})\s?EP?\s?\((\d{1,3})[-‑](\d{1,3})\)/i, type: 'EPISODE_PACK' },
    // Case 2: Full packs like S02EP01-07 or S01E01-E16
    { regex: /S(\d{1,2})\s?E(\d{1,3})[-‑]E?(\d{1,3})/i, type: 'EPISODE_PACK' },
    // Case 3: Full packs like S01EP01-04 (no space, no parens)
    { regex: /S(\d{1,2})EP(\d{1,3})[-‑](\d{1,3})/i, type: 'EPISODE_PACK' },
    // Case 4: Single Episodes like S01EP16, S02 EP(06), or S03 EP07
    { regex: /S(\d{1,2})\s?EP?\(?(\d{1,3})\)?(?![-‑])/i, type: 'SINGLE_EPISODE' },
    // Case 5: Season-only packs like S1, S02, or titles with "Complete" / "Season"
    { regex: /(?:S(eason)?\s*)(\d{1,2})(?!\s?E|\s?\d)|(Complete\sSeason|Season\s\d{1,2})/i, type: 'SEASON_PACK' }
];

/**
 * Parses a thread title using PTT after cleaning it.
 * @param {string} rawTitle The raw title from the forum.
 * @returns {object|null} An object with { clean_title, year } or null.
 */
function parseTitle(rawTitle) {
    const cleanedForPtt = rawTitle.replace(/By\s[\w\s.-]+,.*$/i, '').trim();
    const pttResult = ptt.parse(cleanedForPtt);

    if (pttResult.title && pttResult.year) {
        return { clean_title: pttResult.title, year: pttResult.year };
    }
    
    logger.error(`PTT parsing failed for title: "${rawTitle}"`);
    return null;
}

/**
 * Parses a magnet URI's 'dn' parameter to extract stream metadata.
 * @param {string} magnetUri The full magnet URI.
 * @returns {object|null} An object with stream metadata and a 'type' field.
 */
function parseMagnet(magnetUri) {
    try {
        const params = new URLSearchParams(magnetUri.split('?')[1]);
        const infohash = params.get('xt')?.replace('urn:btih:', '');
        let filename = params.get('dn') || '';
        if (!infohash || !filename) {
            logger.warn({ magnetUri }, 'Magnet URI missing required parameters (xt, dn).');
            return null;
        }

        filename = decodeURIComponent(filename).replace(/^www\.\w+\.\w+\s*-\s*/, '').trim();

        const pttResult = ptt.parse(filename);
        let season, episode, episodeStart, episodeEnd;

        for (const pattern of PARSING_PATTERNS) {
            const match = filename.match(pattern.regex);
            if (match) {
                if (pattern.type === 'SEASON_PACK') {
                    // Use the captured season number or fallback to PTT's result
                    season = parseInt(match[1] || match[2]?.match(/\d+/)[0] || pttResult.season);
                    if (season) return { type: 'SEASON_PACK', infohash, season, quality: pttResult.resolution, language: pttResult.language };
                } else if (pattern.type === 'SINGLE_EPISODE') {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                    if (season && episode) return { type: 'SINGLE_EPISODE', infohash, season, episode, quality: pttResult.resolution, language: pttResult.language };
                } else if (pattern.type === 'EPISODE_PACK') {
                    season = parseInt(match[1]);
                    episodeStart = parseInt(match[2]);
                    episodeEnd = parseInt(match[3]);
                    if (season && episodeStart && episodeEnd) return { type: 'EPISODE_PACK', infohash, season, episodeStart, episodeEnd, quality: pttResult.resolution, language: pttResult.language };
                }
            }
        }
        
        // Fallback to PTT's results if no advanced pattern matched
        if (pttResult.season && pttResult.episode) {
            return { type: 'SINGLE_EPISODE', infohash, season: pttResult.season, episode: pttResult.episode, quality: pttResult.resolution, language: pttResult.language };
        }
        if (pttResult.season) {
            return { type: 'SEASON_PACK', infohash, season: pttResult.season, quality: pttResult.resolution, language: pttResult.language };
        }

        logger.warn({ filename }, 'All parsing patterns failed for magnet dn.');
        return null;

    } catch (e) {
        logger.error({ err: e, magnet: magnetUri.substring(0, 70) }, `Magnet parsing failed`);
        return null;
    }
}

module.exports = { parseTitle, parseMagnet };
