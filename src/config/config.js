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
    placeholderPoster: 'https://i.imgur.com/b54abw2.png',

    trackers: [
        "udp://tracker.opentrackr.org:1337/announce",
"udp://open.demonii.com:1337/announce",
"udp://open.stealth.si:80/announce",
"udp://exodus.desync.com:6969/announce",
"udp://tracker.torrent.eu.org:451/announce",
"udp://tracker.dump.cl:6969/announce",
"udp://tracker.bittor.pw:1337/announce",
"udp://p4p.arenabg.com:1337/announce",
"udp://open.free-tracker.ga:6969/announce",
"udp://leet-tracker.moe:1337/announce",
"udp://explodie.org:6969/announce",
"http://www.torrentsnipe.info:2701/announce",
"http://tracker.xiaoduola.xyz:6969/announce",
"http://tracker.vanitycore.co:6969/announce",
"http://tracker.moxing.party:6969/announce",
"http://tracker.dmcomic.org:2710/announce",
"http://retracker.spark-rostov.ru:80/announce",
"http://finbytes.org:80/announce.php",
"http://buny.uk:6969/announce",
"udp://wepzone.net:6969/announce"
    ],
    
    appHost: process.env.APP_HOST || 'http://127.0.0.1:3000',
};

// Validate required variables
if (!config.forumUrl || !config.tmdbApiKey) {
    throw new Error("Missing required environment variables: FORUM_URL, TMDB_API_KEY");
}

module.exports = config;
