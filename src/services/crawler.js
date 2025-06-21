// src/services/crawler.js
const { CheerioCrawler } = require('crawlee');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config/config');

const generateThreadHash = (title, magnets) => {
    // Hash now uses only the magnet URIs for consistency
    const magnetUris = magnets.map(m => m.uri).sort().join('');
    const data = title + magnetUris;
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

    const magnetSelector = 'a[href^="magnet:?"]';
    const magnets = [];

    // FIX: Instead of just getting the href, we get the magnet link element
    // and its surrounding context, which is more reliable.
    $(magnetSelector).each((index, element) => {
        const magnetEl = $(element);
        const uri = magnetEl.attr('href');

        // Heuristic: Find the closest block-level parent and get its text.
        // This usually contains the full descriptive title for the magnet.
        // We look for a div or p tag. If not found, we use the immediate parent.
        const contextEl = magnetEl.closest('div, p');
        const context = (contextEl.length ? contextEl : magnetEl.parent()).text().trim();

        if (uri) {
            magnets.push({ uri, context });
        }
    });

    if (magnets.length > 0) {
        log.info(`Found ${magnets.length} magnet links for "${raw_title}"`);
        const thread_hash = generateThreadHash(raw_title, magnets);
        
        await processor({ thread_hash, raw_title, magnets });
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
