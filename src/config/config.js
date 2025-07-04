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
    
    // NEW: Optional timeout for scraper requests in seconds
    scraperTimeoutSecs: parseInt(process.env.SCRAPER_TIMEOUT_SECS, 10) || 30,
    
    // NEW: Optional User-Agent for scraper requests
    scraperUserAgent: process.env.SCRAPER_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',

    // TMDB API Key
    tmdbApiKey: process.env.TMDB_API_KEY,

    // Real-Debrid API Key (Optional)
    realDebridApiKey: process.env.REALDEBRID_API_KEY || null,

    // Proxy Configuration
    proxyUrls: process.env.PROXY_URLS ? process.env.PROXY_URLS.split(',').map(url => url.trim()) : [],

    // Stremio Manifest
    addonId: 'org.stremio.torrent.nodejs.example',
    addonName: 'TamilMV WebSeries',
    addonDescription: 'A Stremio addon providing streams from a TamilMV torrent forum.',
    addonVersion: '1.0.0',
    placeholderPoster: 'https://upload.wikimedia.org/wikipedia/en/thumb/d/da/Aha_%28streaming_service.svg/250px-Aha_%28streaming_service.svg.png',

    trackerUrl: process.env.TRACKER_URL || "https://ngosang.github.io/trackerslist/trackers_best.txt",
    
    appHost: process.env.APP_HOST || 'http://127.0.0.1:3000',
};

// Add boolean flags for easy checking
config.isRdEnabled = !!config.realDebridApiKey;
config.isProxyEnabled = config.proxyUrls.length > 0;

// Validate required variables
if (!config.forumUrl || !config.tmdbApiKey) {
    throw new Error("Missing required environment variables: FORUM_URL, TMDB_API_KEY");
}

module.exports = config;
