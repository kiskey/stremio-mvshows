// src/services/crawler.js
const { CheerioCrawler, EnqueueStrategy } = require('crawlee');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config/config');

const generateThreadHash = (title, magnets) => {
    const data = title + [...magnets].sort().join('');
    return crypto.createHash('sha256').update(data).digest('hex');
};

const createCrawler = (processor) => {
    return new CheerioCrawler({
        maxRequestsPerCrawl: config.maxCrawlPages + 10, // Safety buffer
        async requestHandler({ $, request, enqueueLinks }) {
            logger.info(`Crawling: ${request.url}`);

            // Enqueue next pages
            await enqueueLinks({
                // This selector must be adapted to the forum's "Next Page" button
                selector: 'a.next-page-link',
                strategy: EnqueueStrategy.SameDomain,
            });

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
        failedRequestRetryCount: 1,
    });
};

const runCrawler = async (processor) => {
    const crawler = createCrawler(processor);
    const startUrl = `${config.forumUrl}/page/1`;
    logger.info(`Starting crawl at: ${startUrl}`);
    await crawler.run([startUrl]);
    logger.info("Crawl finished.");
};

module.exports = { runCrawler };
