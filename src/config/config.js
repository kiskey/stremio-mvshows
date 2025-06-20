// src/config/config.js
require('dotenv').config();

const config = {
    port: process.env.PORT || 3000,
    logLevel: process.env.LOG_LEVEL || 'info',
    
  
    // --- NEW: Scraper Configuration ---
    forumUrl: process.env.FORUM_URL, // e.g., "https://some-forum.com/c/movies/12"
    scrapeStartPage: parseInt(process.env.SCRAPE_START_PAGE, 10) || 1,
    scrapeEndPage: parseInt(process.env.SCRAPE_END_PAGE, 10) || 20, // Replaces maxCrawlPages
    scraperConcurrency: parseInt(process.env.SCRAPER_CONCURRENCY, 10) || 5, // Number of parallel requests
    scraperRetryCount: parseInt(process.env.SCRAPER_RETRY_COUNT, 10) || 3, // Number of retries on failure

    // --- NEW: LLM Configuration ---
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-pro', // Make the model configurable
    tmdbApiKey: process.env.TMDB_API_KEY,

    // Stremio Manifest
    addonId: 'org.stremio.torrent.nodejs.example',
    addonName: 'NodeJS Torrent Addon',
    addonDescription: 'A Stremio addon providing streams from a forum using Node.js.',
    addonVersion: '1.0.0',

    trackers: [
        "udp://tracker.openbittorrent.com:80",
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://tracker.ngosang.dev:1337/announce",
        "udp://p4p.arenabg.com:1337/announce"
    ],
    
    appHost: process.env.APP_HOST || 'http://127.0.0.1:3000',
};

// Validate required variables
if (!config.forumUrl || !config.geminiApiKey || !config.tmdbApiKey) {
    throw new Error("Missing required environment variables: FORUM_URL, GEMINI_API_KEY, TMDB_API_KEY");
}

module.exports = config;
