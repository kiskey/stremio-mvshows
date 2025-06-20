// src/services/crawler.js
const { CheerioCrawler } = require('crawlee');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config/config');

const generateThreadHash = (title, magnets) => {
    const data = title + [...magnets].sort().join('');
    return crypto.createHash('sha256').update(data).digest('hex');
};

const createCrawler = (processor) => {
    return new CheerioCrawler({
        // --- USE CONFIG VALUES ---
        maxConcurrency: config.scraperConcurrency,
        failedRequestRetryCount: config.scraperRetryCount,
        // We will manually manage requests, so no need for enqueueLinks
        
        async requestHandler({ $, request }) {
            logger.info(`Crawling: ${request.url}`);

            // This selector must be adapted to the forum's thread list structure
            const threadElements = $('div.thread-item'); // EXAMPLE SELECTOR
            for (const el of threadElements) {
                const element = $(el);
                // These selectors must also be adapted
                const thread_title = element.find('a.thread-title').text().trim();
                const magnet_uris = element.find('a[href^="magnet:?"]')
                    .map((i, a) => $(a).attr('href')).get();

                if (thread_title && magnet_uris.length > 0) {
                    const thread_hash = generateThreadHash(thread_title, magnet_uris);
                    await processor({ thread_hash, raw_title: thread_title, magnet_uris });
                }
            }
        },
    });
};

const runCrawler = async (processor) => {
    const crawler = createCrawler(processor);
    
    // --- GENERATE START URLS FROM CONFIG ---
    const startUrls = [];
    for (let i = config.scrapeStartPage; i <= config.scrapeEndPage; i++) {
        // Adapt the URL structure if your forum uses something other than /page/
        startUrls.push(`${config.forumUrl}/page/${i}`);
    }

    logger.info({
        startPage: config.scrapeStartPage,
        endPage: config.scrapeEndPage,
        concurrency: config.scraperConcurrency,
        retryCount: config.scraperRetryCount,
    }, `Starting crawl of ${startUrls.length} pages.`);
    
    await crawler.run(startUrls);
    logger.info("Crawl finished.");
};

module.exports = { runCrawler };
