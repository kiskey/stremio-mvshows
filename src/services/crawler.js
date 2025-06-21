// src/services/crawler.js
const { CheerioCrawler } = require('crawlee');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config/config');

const generateThreadHash = (title, magnetUris) => {
    const magnetData = magnetUris.sort().join('');
    const data = title + magnetData;
    return crypto.createHash('sha256').update(data).digest('hex');
};

const createCrawler = (processor) => {
    return new CheerioCrawler({
        maxConcurrency: config.scraperConcurrency,
        maxRequestRetries: config.scraperRetryCount,

        async requestHandler(context) {
            const { request, log } = context;
            const { label } = request;

            switch (label) {
                case 'LIST':
                    return handleListPage(context);
                case 'DETAIL':
                    return handleDetailPage(context, processor);
                default:
                    log.error(`Unhandled request label '${label}' for URL: ${request.url}`);
            }
        },
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
            log.debug(`Found topic: "${raw_title}"`);
            newRequests.push({
                url: url,
                label: 'DETAIL',
                userData: { raw_title },
            });
        }
    });

    if (newRequests.length > 0) {
        log.info(`Enqueuing ${newRequests.length} detail pages to scrape...`);
        await crawler.addRequests(newRequests);
    }
}

async function handleDetailPage({ $, request, log }, processor) {
    const { userData } = request;
    const { raw_title } = userData;

    log.info(`Processing DETAIL page for: "${raw_title}"`);

    // FIX: Revert to only grabbing the magnet URI itself.
    // The parser will now use the 'dn' parameter, which is more reliable.
    const magnetSelector = 'a[href^="magnet:?"]';
    const magnet_uris = $(magnetSelector)
        .map((i, el) => $(el).attr('href'))
        .get();

    if (magnet_uris.length > 0) {
        log.info(`Found ${magnet_uris.length} magnet links for "${raw_title}"`);
        const thread_hash = generateThreadHash(raw_title, magnet_uris);
        
        await processor({ thread_hash, raw_title, magnet_uris });
    } else {
        log.warning(`No magnet links found on detail page for "${raw_title}"`);
    }
}


const runCrawler = async (processor) => {
    const crawler = createCrawler(processor);
    const startRequests = [];
    const baseUrl = config.forumUrl.replace(/\/$/, '');

    for (let i = config.scrapeStartPage; i <= config.scrapeEndPage; i++) {
        let url;
        if (i === 1) {
            url = baseUrl;
        } else {
            url = `${baseUrl}/page/${i}`;
        }
        startRequests.push({ url, label: 'LIST' });
    }

    logger.info({
        startPage: config.scrapeStartPage,
        endPage: config.scrapeEndPage,
        concurrency: config.scraperConcurrency,
        maxRetries: config.scraperRetryCount,
        urls: startRequests.map(r => r.url)
    }, `Starting crawl of ${startRequests.length} pages.`);
    
    await crawler.run(startRequests);
    logger.info("Crawl run has completed.");
};

module.exports = { runCrawler };
