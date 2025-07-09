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
        navigationTimeoutSecs: config.scraperTimeoutSecs,
        maxConcurrency: config.scraperConcurrency,
        maxRequestRetries: config.scraperRetryCount,

        preNavigationHooks: [
            (crawlingContext, gotOptions) => {
                gotOptions.headers = {
                    ...gotOptions.headers,
                    'User-Agent': config.scraperUserAgent,
                };
                
                gotOptions.timeout = { request: config.scraperTimeoutSecs * 1000 };

                if (!config.isProxyEnabled) {
                    return;
                }
                
                const originalUrl = crawlingContext.request.url;
                const proxyUrl = config.proxyUrls[proxyIndex % config.proxyUrls.length];
                proxyIndex++;

                logger.debug({ proxy: proxyUrl, target: originalUrl }, "Transforming request for proxy.");

                gotOptions.url = proxyUrl;
                gotOptions.method = 'POST';
                gotOptions.json = { pageURL: originalUrl };
            }
        ],

        async requestHandler(context) {
            const { request, log, $ } = context;

            if (!$ || typeof $.html !== 'function') {
                log.error(`Request for ${request.url} did not return valid HTML. It might be a block page, a JSON error, or an empty response.`, {
                    contentType: context.response?.headers['content-type'],
                });
                return;
            }
            
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

        failedRequestHandler({ request, log, error }) {
            log.error(`Request ${request.url} failed and reached maximum retries.`, {
                url: request.url,
                retryCount: request.retryCount,
                error: error.message,
                statusCode: error.response?.statusCode,
                responseHeaders: error.response?.headers,
                responseBodySnippet: error.response?.body?.toString().substring(0, 200),
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
    
    // --- NEW LOGIC: Iterate over all configured forum URLs ---
    config.forumUrls.forEach(baseUrl => {
        const cleanBaseUrl = baseUrl.replace(/\/$/, '');
        
        // This existing loop now runs for each forum in the list
        for (let i = config.scrapeStartPage; i <= config.scrapeEndPage; i++) {
            let url = i === 1 ? cleanBaseUrl : `${cleanBaseUrl}/page/${i}`;
            startRequests.push({ url, label: 'LIST' });
        }
    });
    // --- END NEW LOGIC ---

    const logInfo = {
        totalRequests: startRequests.length,
        forumCount: config.forumUrls.length
    };

    if (config.isProxyEnabled) {
        logger.info({ ...logInfo, proxyCount: config.proxyUrls.length }, `Starting crawl using proxies.`);
    } else {
        logger.info(logInfo, `Starting direct crawl.`);
    }
    
    await crawler.run(startRequests);
    
    logger.info(`Crawl run has completed. Scraped ${crawledData.length} total threads with magnets.`);
    return crawledData;
};

module.exports = { runCrawler };
