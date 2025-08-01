// src/services/crawler.js
const { CheerioCrawler } = require('crawlee');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config/config');

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
                gotOptions.headers = { ...gotOptions.headers, 'User-Agent': config.scraperUserAgent };
                gotOptions.timeout = { request: config.scraperTimeoutSecs * 1000 };
                if (!config.isProxyEnabled) { return; }
                const originalUrl = crawlingContext.request.url;
                const proxyUrl = config.proxyUrls[proxyIndex % config.proxyUrls.length];
                proxyIndex++;
                crawlingContext.log.debug({ proxy: proxyUrl, target: originalUrl }, "Transforming request for proxy.");
                gotOptions.url = proxyUrl;
                gotOptions.method = 'POST';
                gotOptions.json = { pageURL: originalUrl };
            }
        ],

        // --- START OF DEFINITIVE FIX ---
        // Destructure the context object directly in the handler's signature.
        async requestHandler({ request, log, $, crawler }) {
            if (!$ || typeof $.html !== 'function') {
                log.error(`Request for ${request.url} did not return valid HTML.`, { contentType: request.response?.headers['content-type'] });
                return;
            }
            
            const { label } = request;
            switch (label) {
                // Pass the destructured context properties to the helper functions.
                case 'LIST': await handleListPage({ log, $, crawler, request }, crawledData); break;
                case 'DETAIL': await handleDetailPage({ log, $, request }, crawledData); break;
                default: log.error(`Unhandled request label '${label}' for URL: ${request.url}`);
            }
        },

        // Correctly destructure the context and use the second parameter for the error.
        failedRequestHandler({ request, log }, error) {
            log.error(`Request ${request.url} failed and reached maximum retries.`, {
                url: request.url, retryCount: request.retryCount, error: error.message,
                statusCode: error.response?.statusCode, responseBodySnippet: error.response?.body?.toString().substring(0, 200),
            });
        }
        // --- END OF DEFINITIVE FIX ---
    });
};

// --- START OF DEFINITIVE FIX ---
// The function now accepts the destructured context properties.
async function handleListPage({ log, $, crawler, request }, crawledData) {
    const { type } = request.userData;
    const newRequests = [];
    const detailLinkSelector = 'h4.ipsDataItem_title > span.ipsType_break > a';

    $(detailLinkSelector).each((index, element) => {
        const linkEl = $(element);
        const threadContainer = linkEl.closest('div.ipsDataItem');

        if (threadContainer.length > 0) {
            const url = linkEl.attr('href');
            const raw_title = linkEl.text().trim();
            const timeEl = threadContainer.find('time[datetime]');
            const postedAt = timeEl.attr('datetime') ? new Date(timeEl.attr('datetime')) : null;

            if (url && raw_title) {
                newRequests.push({ 
                    url, 
                    label: 'DETAIL', 
                    userData: { raw_title, type, postedAt }
                });
            }
        }
    });

    if (newRequests.length > 0) {
        // CORRECT USAGE: `log` is now the logger instance.
        log.info(`Enqueuing ${newRequests.length} detail pages of type '${type}' from list page.`);
        await crawler.addRequests(newRequests);
    } else {
        // CORRECT USAGE: `log` is now the logger instance.
        log.warn({ url: request.url }, "No detail page links found on list page. The page structure might have changed.");
    }
}

// The function now accepts the destructured context properties.
async function handleDetailPage({ log, $, request }, crawledData) {
    const { userData } = request;
    const { raw_title, type, postedAt } = userData;
    
    const magnetSelector = 'a[href^="magnet:?"]';
    const magnet_uris = $(magnetSelector).map((i, el) => $(el).attr('href')).get();

    if (magnet_uris.length > 0) {
        const thread_hash = generateThreadHash(raw_title, magnet_uris);
        crawledData.push({ thread_hash, raw_title, magnet_uris, type, postedAt });
        log.debug({ title: raw_title, type, postedAt }, "Successfully scraped detail page.");
    } else {
        log.warn(`No magnet links found on detail page for "${raw_title}"`);
    }
}
// --- END OF DEFINITIVE FIX ---

const runCrawler = async () => {
    const crawledData = [];
    const crawler = createCrawler(crawledData);
    const startRequests = [];
    
    const addScrapeTasks = (urls, type) => {
        urls.forEach(baseUrl => {
            const cleanBaseUrl = baseUrl.replace(/\/$/, '');
            for (let i = config.scrapeStartPage; i <= config.scrapeEndPage; i++) {
                let url = i === 1 ? cleanBaseUrl : `${cleanBaseUrl}/page/${i}`;
                startRequests.push({ url, label: 'LIST', userData: { type } });
            }
        });
    };

    addScrapeTasks(config.seriesForumUrls, 'series');
    addScrapeTasks(config.movieForumUrls, 'movie');
    addScrapeTasks(config.dubbedMovieForumUrls, 'movie');

    const logInfo = {
        totalRequests: startRequests.length,
        forumCount: config.seriesForumUrls.length + config.movieForumUrls.length + config.dubbedMovieForumUrls.length
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
