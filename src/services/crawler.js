// src/services/crawler.js
const { CheerioCrawler } = require('crawlee');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config/config');

// Manage proxy rotation state at the module level
let proxyIndex = 0;

const generateThreadHash = (title, magnetUris) => {
    const magnetData = magnetUris.sort().join('');
    const data = title + magnetData;
    return crypto.createHash('sha256').update(data).digest('hex');
};

const createCrawler = (crawledData) => {
    return new CheerioCrawler({
        navigationTimeoutSecs: 60,
        maxConcurrency: config.scraperConcurrency,
        maxRequestRetries: config.scraperRetryCount,

        // Use preNavigationHooks to transform requests for the proxy service
        preNavigationHooks: [
            (crawlingContext, request) => {
                // If proxies are not enabled in the config, do nothing.
                if (!config.isProxyEnabled) {
                    return;
                }
                
                // 1. Store the original target URL.
                const originalUrl = request.url;
                
                // 2. Select the next proxy service endpoint, rotating through the list.
                const proxyUrl = config.proxyUrls[proxyIndex % config.proxyUrls.length];
                proxyIndex++; // Increment for the next request.

                logger.debug({ proxy: proxyUrl, target: originalUrl }, "Transforming request for proxy.");

                // 3. Overwrite the request object to be a POST request to the proxy.
                request.url = proxyUrl; // The URL we actually visit is the proxy service.
                request.method = 'POST';
                request.payload = JSON.stringify({ pageURL: originalUrl }); // The body of the POST request.
                request.headers = {
                    ...request.headers,
                    'Content-Type': 'application/json',
                };
            }
        ],

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
        log.info(`Enqueuing ${newRequests.length} detail pages from list page.`);
        // The preNavigationHook will automatically handle these new requests as well.
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

    // The loop becomes simple again. The hook handles all proxy logic.
    for (let i = config.scrapeStartPage; i <= config.scrapeEndPage; i++) {
        let url = i === 1 ? baseUrl : `${baseUrl}/page/${i}`;
        // We queue the *original* target URL. The hook will transform it if needed.
        startRequests.push({ url, label: 'LIST' });
    }

    if (config.isProxyEnabled) {
        logger.info({ count: config.proxyUrls.length }, `Starting crawl of ${startRequests.length} pages using proxies.`);
    } else {
        logger.info(`Starting direct crawl of ${startRequests.length} pages.`);
    }
    
    await crawler.run(startRequests);
    
    logger.info(`Crawl run has completed. Scraped ${crawledData.length} total threads with magnets.`);
    return crawledData;
};

module.exports = { runCrawler };
