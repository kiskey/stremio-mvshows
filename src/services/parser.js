// src/services/parser.js
const ptt = require('parse-torrent-title');
const logger = require('../utils/logger');

// Regex patterns for magnet link parsing (unchanged)
const PARSING_PATTERNS = [
    { regex: /S(\d{1,2})\s?EP?\s?\((\d{1,3})[-‑](\d{1,3})\)/i, type: 'EPISODE_PACK' },
    { regex: /S(\d{1,2})\s?E(\d{1,3})[-‑]E?(\d{1,3})/i, type: 'EPISODE_PACK' },
    { regex: /S(\d{1,2})EP(\d{1,3})[-‑](\d{1,3})/i, type: 'EPISODE_PACK' },
    { regex: /S(\d{1,2})\s?EP?\(?(\d{1,3})\)?(?![-‑])/i, type: 'SINGLE_EPISODE' },
    { regex: /(?:S(eason)?\s*)(\d{1,2})(?!\s?E|\s?\d)|(Complete\sSeason|Season\s\d{1,2})/i, type: 'SEASON_PACK' }
];

// expandEpisodeRange function (unchanged)
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
 * It first attempts to use PTT. If that fails, it uses a multi-pass heuristic fallback.
 * @param {string} rawTitle The raw title from the forum.
 * @returns {object|null} An object with { clean_title, year } or null.
 */
function parseTitle(rawTitle) {
    // --- PRIMARY METHOD (Unchanged) ---
    const cleanedForPtt = rawTitle.replace(/By\s[\w\s.-]+,.*$/i, '').trim();
    const pttResult = ptt.parse(cleanedForPtt);

    if (pttResult.title && pttResult.year) {
        return { clean_title: pttResult.title, year: pttResult.year };
    }

    // --- FALLBACK METHOD (Enhanced with Multi-Pass Heuristics) ---
    logger.warn(`PTT failed to find both title and year for "${rawTitle}". Attempting heuristic fallback.`);
    
    let cleanTitle = cleanedForPtt;
    
    // 1. Extract year first from the original string, as it's the most reliable format.
    const yearMatch = cleanTitle.match(/[\[\(](\d{4})[\]\)]/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
    if (yearMatch) {
        cleanTitle = cleanTitle.replace(yearMatch[0], ' '); // Remove the year for cleaner parsing
    }

    // 2. First Pass: Remove large chunks of known metadata patterns.
    const noisePatterns = [
        /\[.*?\]/g,                                  // Remove all content in square brackets
        /\(.*?Complete Series.*?\)/gi,              // Remove (Complete Series)
        /\b(1080p|720p|480p|2160p|4K|HD|HQ)\b/gi,     // Qualities
        /\b(WEB-DL|HDRip|BluRay|WEBrip|HDTV|UNTOUCHED|TRUE)\b/gi, // Sources
        /\b(x264|x265|HEVC|AVC)\b/gi,                // Codecs
        /\b(AAC|DDP5\.1|ATMOS|AC3)\b/gi,             // Audio
        /\b(\d+(\.\d+)?(GB|MB))\b/gi,                // File sizes
        /\b(Esub|MSubs|Multi-Subs)\b/gi,             // Subtitles
        /\b(Tam|Tel|Hin|Eng|Tamil|Telugu|Hindi|English|Kannada|Malayalam|Mal)\b/gi, // Languages
        /\b(Part|Vol|DAY)\s?\(?\d+.*\)?/gi,          // Part/Volume/Day indicators
        /S\d{1,2}(\s?E\d{1,3})?(\s?-\s?E\d{1,3})?/gi,  // S01, S01E01, S01-E10 patterns
        /\(\s?E\d{1,2}\s?-\s?\d{1,2}\s?\)/gi,          // (E06-10) pattern
        /EP\s?\(?\d+-\d+\)?/gi                       // EP (01-15) patterns
    ];

    for (const pattern of noisePatterns) {
        cleanTitle = cleanTitle.replace(pattern, ' ');
    }
    
    // 3. Second Pass (Polishing): Clean up leftover symbols, dots, and whitespace.
    // This pass is crucial for removing the junk you identified.
    cleanTitle = cleanTitle
        .replace(/[-–_.]/g, ' ')       // Replace common separators with spaces
        .replace(/[\[\](){}&:,]/g, ' ') // Remove standalone brackets, parens, and symbols
        .replace(/\s+/g, ' ')          // Collapse multiple spaces into a single space
        .trim();                       // Trim leading/trailing whitespace

    // 4. Final check for a plausible title.
    if (cleanTitle) {
        logger.info(`Heuristic fallback succeeded for "${rawTitle}". Parsed Title: "${finalTitle}", Year: ${year}`);
        return { clean_title: cleanTitle, year: year };
    }
    
    logger.error(`Critical parsing failure for title: "${rawTitle}". Both PTT and fallback failed.`);
    return null;
}

// parseMagnet function (unchanged)
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

// getInfohash function (unchanged)
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
