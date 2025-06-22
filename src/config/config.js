// src/config/config.js
require('dotenv').config();

const config = {
    port: process.env.PORT || 3000,
    logLevel: process.env.LOG_LEVEL || 'info',
    
    // Scraper Configuration
    forumUrl: process.env.FORUM_URL,
    scrapeStartPage: parseInt(process.env.SCRAPE_START_PAGE, 10) || 1,
    scrapeEndPage: parseInt(process.env.SCRAPE_END_PAGE, 10) || 20,
    scraperConcurrency: parseInt(process.env.SCRAPER_CONCURRENCY, 10) || 5,
    scraperRetryCount: parseInt(process.env.SCRAPER_RETRY_COUNT, 10) || 3,
    
    // TMDB API Key
    tmdbApiKey: process.env.TMDB_API_KEY,

    // Stremio Manifest
    addonId: 'org.stremio.torrent.nodejs.example',
    addonName: 'TamilMV WebSeries Addon',
    addonDescription: 'A Stremio addon providing streams from a TamilMV torrent forum.',
    addonVersion: '1.0.0',
       // NEW: A placeholder poster for content that hasn't been matched yet.
    placeholderPoster: 'https://upload.wikimedia.org/wikipedia/en/thumb/d/da/Aha_%28streaming_service.svg/250px-Aha_%28streaming_service.svg.png',

   // FIX: Tracker URL is now configurable
    trackerUrl: process.env.TRACKER_URL || "https://ngosang.github.io/trackerslist/trackers_best.txt",
    
    
    appHost: process.env.APP_HOST || 'http://127.0.0.1:3000',
};

// Validate required variables
if (!config.forumUrl || !config.tmdbApiKey) {
    throw new Error("Missing required environment variables: FORUM_URL, TMDB_API_KEY");
}

module.exports = config;
