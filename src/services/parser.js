// src/services/parser.js
const ptt = require('parse-torrent-title');
const logger = require('../utils/logger');

// Regex patterns inspired by the provided example for maximum accuracy.
const PARSING_PATTERNS = [
    { regex: /S(\d{1,2})\s?EP?\s?\((\d{1,3})[-‑](\d{1,3})\)/i, type: 'EPISODE_PACK' },
    { regex: /S(\d{1,2})\s?E(\d{1,3})[-‑]E?(\d{1,3})/i, type: 'EPISODE_PACK' },
    { regex: /S(\d{1,2})EP(\d{1,3})[-‑](\d{1,3})/i, type: 'EPISODE_PACK' },
    { regex: /S(\d{1,2})\s?EP?\(?(\d{1,3})\)?(?![-‑])/i, type: 'SINGLE_EPISODE' },
    { regex: /(?:S(eason)?\s*)(\d{1,2})(?!\s?E|\s?\d)|(Complete\sSeason|Season\s\d{1,2})/i, type: 'SEASON_PACK' }
];

/**
 * Expands a numeric range from a string, handling multiple formats.
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
 * Parses a thread title using a multi-step process to be more resilient.
 * It first attempts to use PTT. If that fails, it uses a heuristic fallback.
 * @param {string} rawTitle The raw title from the forum.
 * @returns {object|null} An object with { clean_title, year } or null.
 */
function parseTitle(rawTitle) {
    // --- PRIMARY METHOD (Unchanged) ---
    // First, attempt to parse using the original, proven PTT method.
    const cleanedForPtt = rawTitle.replace(/By\s[\w\s.-]+,.*$/i, '').trim();
    const pttResult = ptt.parse(cleanedForPtt);

    if (pttResult.title && pttResult.year) {
        // Success! The original flow worked. Return immediately.
        return { clean_title: pttResult.title, year: pttResult.year };
    }

    // --- FALLBACK METHOD (New "Second Chance" Logic) ---
    // This block only runs if the primary method above failed.
    logger.warn(`PTT failed to find both title and year for "${rawTitle}". Attempting heuristic fallback.`);
    
    let cleanTitle = cleanedForPtt;
    
    // 1. Try to extract a year from the original string, as it's the most reliable format.
    const yearMatch = cleanTitle.match(/[\[\(](\d{4})[\]\)]/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

    // 2. Define known metadata "noise" to be removed using heuristics.
    const noisePatterns = [
        /\[.*?\]/g,                                  // Remove all content in square brackets
        /\(.*?Complete Series.*?\)/gi,              // Remove (Complete Series)
        /\b(1080p|720p|480p|2160p|4K|HD|HQ)\b/gi,     // Qualities
        /\b(WEB-DL|HDRip|BluRay|WEBrip|HDTV|UNTOUCHED)\b/gi,   // Sources
        /\b(x264|x265|HEVC|AVC)\b/gi,                // Codecs
        /\b(AAC|DDP5\.1|ATMOS|AC3)\b/gi,             // Audio
        /\b(\d+(\.\d+)?(GB|MB))\b/gi,                // File sizes
        /\b(Esub|MSubs|Multi-Subs)\b/gi,             // Subtitles
        /\b(Tam|Tel|Hin|Eng|Tamil|Telugu|Hindi|English|Kannada|Malayalam|Mal)\b/gi, // Languages
        /\b(Part|Vol)\s?\d+/gi,                      // Part/Volume
        /S\d{1,2}(\s?E\d{1,3})?(\s?-\s?E\d{1,3})?/gi,  // S01, S01E01, S01-E10 patterns
        /\(\s?E\d{1,2}\s?-\s?\d{1,2}\s?\)/gi,          // (E06-10) pattern
        /EP\s?\(?\d+-\d+\)?/gi,                       // EP (01-15) patterns
        /[-–_.]/g                                    // Replace common separators with spaces
    ];

    // 3. Systematically remove the noise from the title.
    for (const pattern of noisePatterns) {
        cleanTitle = cleanTitle.replace(pattern, ' ');
    }
    
    // 4. Clean up the resulting string.
    // Remove extra whitespace and any leftover standalone characters.
    const finalTitle = cleanTitle.trim().replace(/\s+/g, ' ');

    // 5. If we are left with a plausible title, return it.
    if (finalTitle) {
        logger.info(`Heuristic fallback succeeded for "${rawTitle}". Parsed Title: "${finalTitle}", Year: ${year}`);
        return { clean_title: finalTitle, year: year };
    }
    
    // If both methods have failed, we log the critical failure.
    logger.error(`Critical parsing failure for title: "${rawTitle}". Both PTT and fallback failed.`);
    return null;
}

/**
 * Parses a magnet URI's 'dn' parameter to extract stream metadata.
 * @param {string} magnetUri The full magnet URI.
 * @returns {object|null} An object with stream metadata and a 'type' field.
 */
function parseMagnet(magnetUri) {
    try {
        const infohash = getInfohash(magnetUri);
        const params = new URLSearchParams(magnetUri.split('?')[1]);
        let filename = params.get('dn') || '';
        if (!infohash || !filename) return null;

        filename = decodeURIComponent(filename).replace(/^www\.\w+\.\w+\s*-\s*/, '').trim();

        const pttResult = ptt.parse(filename);
        let season, episode, episodeStart, episodeEnd;

        for (const pattern of PARSING_PATTERNS) {
            const match = filename.match(pattern.regex);
            if (match) {
                if (pattern.type === 'SEASON_PACK') {
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

/**
 * Extracts the infohash from a magnet URI.
 * @param {string} magnetUri The full magnet URI.
 * @returns {string|null} The infohash or null if not found.
 */
function getInfohash(magnetUri) {
    if (!magnetUri) return null;
    const match = magnetUri.match(/btih:([a-fA-F0-9]{40})/);
    return match ? match[1].toLowerCase() : null;
}

module.exports = { 
    parseTitle, 
    parseMagnet,
    getInfohash
};
