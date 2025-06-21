// src/services/crawler.js
const { CheerioCrawler, Configuration } = require('crawlee');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config/config');

const generateThreadHash = (title, magnetUris) => {
    const magnetData = magnetUris.sort().join('');
    const data = title + magnetData;
    return crypto.createHash('sha256').update(data).digest('hex');
};

const createCrawler = (crawledData) => {
    return new CheerioCrawler({
        // FIX: Increase the navigation timeout to better handle slow network/server responses.
        navigationTimeoutSecs: 60, 
        maxConcurrency: config.scraperConcurrency,
        maxRequestRetries: config.scraperRetryCount,

        async requestHandler(context) {
            const { request, log } = context;
            const { label } = request;

            switch (label) {
                case 'LIST':
                    await handleListPage(context);
                    break;
                case 'DETAIL':
                    await handleDetailPage(context, crawledData); 
                    break;
                default:
                    log.error(`Unhandled request label '${label}' for URL: ${request.url}`);
            }
        },
        // FIX: Add a dedicated error handler for better logging
        failedRequestHandler({ request, log }) {
            log.error(`Request ${request.url} failed and reached maximum retries.`, {
                url: request.url,
                retryCount: request.retryCount
            });
        }
    });
};

async function handleListPage({ $, log, crawler }) {
    const detailLinkSelector = 'h4.ipsDataItem_title > span.ipsType_break > a';
    const newRequests = [];
    $(detailLinkSelector).each((index, element) => {
        const linkEl = $(element);
        const url = linkEl.attr('href');
        const raw_title = linkEl.text().trim();
        if (url && raw_title) {
            newRequests.push({ url, label: 'DETAIL', userData: { raw_title } });
        }
    });
    if (newRequests.length > 0) {
        log.info(`Enqueuing ${newRequests.length} detail pages from ${crawler.running_request.url}`);
        await crawler.addRequests(newRequests);
    }
}

async function handleDetailPage({ $, request, log }, crawledData) {
    const { userData } = request;
    const { raw_title } = userData;
    const magnetSelector = 'a[href^="magnet:?"]';
    const magnet_uris = $(magnetSelector).map((i, el) => $(el).attr('href')).get();
    if (magnet_uris.length > 0) {
        const thread_hash = generateThreadHash(raw_title, magnet_uris);
        crawledData.push({ thread_hash, raw_title, magnet_uris });
    } else {
        log.warning(`No magnet links found on detail page for "${raw_title}"`);
    }
}

const runCrawler = async () => {
    const crawledData = [];
    const crawler = createCrawler(crawledData);
    const startRequests = [];
    const baseUrl = config.forumUrl.replace(/\/$/, '');
    for (let i = config.scrapeStartPage; i <= config.scrapeEndPage; i++) {
        let url = i === 1 ? baseUrl : `${baseUrl}/page/${i}`;
        startRequests.push({ url, label: 'LIST' });
    }
    logger.info({
        startPage: config.scrapeStartPage,
        endPage: config.scrapeEndPage,
        urls: startRequests.map(r => r.url)
    }, `Starting crawl of ${startRequests.length} pages.`);
    
    await crawler.run(startRequests);
    logger.info(`Crawl run has completed. Scraped ${crawledData.length} total threads.`);
    return crawledData;
};

module.exports = { runCrawler };
