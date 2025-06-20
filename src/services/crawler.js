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
        maxConcurrency: config.scraperConcurrency,
        maxRequestRetries: config.scraperRetryCount,

        // This is the core of the new logic. It handles different page types.
        async requestHandler(context) {
            const { request, log } = context;
            const { label, userData } = request;

            // Route the logic based on the page type (label)
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

// --- HANDLER FOR THE MAIN FORUM PAGES (e.g., /page/1) ---
async function handleListPage({ $, request, log, crawler }) {
    log.info(`Processing LIST page: ${request.url}`);

    // This selector is based on your HTML snippet for the link to a detail page.
    const detailLinkSelector = 'h4.ipsDataItem_title a';

    const newRequests = [];
    $(detailLinkSelector).each((index, element) => {
        const linkEl = $(element);
        const url = linkEl.attr('href');
        const raw_title = linkEl.text().trim();

        if (url && raw_title) {
            log.debug(`Found topic: "${raw_title}"`);
            // Add the detail page to the queue.
            // Pass the title along using userData so we have it on the detail page.
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

// --- HANDLER FOR THE TOPIC DETAIL PAGES ---
async function handleDetailPage({ $, request, log }, processor) {
    const { userData } = request;
    const { raw_title } = userData; // Retrieve the title passed from the list page.

    log.info(`Processing DETAIL page for: "${raw_title}"`);

    const magnetSelector = 'a[href^="magnet:?"]';
    const magnet_uris = $(magnetSelector)
        .map((i, el) => $(el).attr('href'))
        .get();

    if (magnet_uris.length > 0) {
        log.info(`Found ${magnet_uris.length} magnet links for "${raw_title}"`);
        const thread_hash = generateThreadHash(raw_title, magnet_uris);
        
        // We now have all the data needed. Call the orchestrator's processor function.
        await processor({ thread_hash, raw_title, magnet_uris });
    } else {
        log.warn(`No magnet links found on detail page for "${raw_title}"`);
    }
}


const runCrawler = async (processor) => {
    const crawler = createCrawler(processor);

    // Generate the initial list of forum pages to visit
    const startRequests = [];
    const baseUrl = config.forumUrl.replace(/\/$/, '');

    for (let i = config.scrapeStartPage; i <= config.scrapeEndPage; i++) {
        let url;
        if (i === 1) {
            url = baseUrl;
        } else {
            url = `${baseUrl}/page/${i}`;
        }
        // These are all 'LIST' pages.
        startRequests.push({ url, label: 'LIST' });
    }

    logger.info({
        ...config, // Log all config for easy debugging
        startRequestCount: startRequests.length,
    }, `Starting crawl...`);

    await crawler.run(startRequests);
    logger.info("Crawl run has completed.");
};

module.exports = { runCrawler };
