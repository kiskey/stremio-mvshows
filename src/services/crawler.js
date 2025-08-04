// src/services/crawler.js
const { CheerioCrawler, log, purgeDefaultStorages } = require('crawlee');
const crypto = require('crypto');
const config = require('../config/config');
const logger = require('../utils/logger');
const fs = require('fs/promises');
const path = require('path');

let proxyIndex = 0;

const generateThreadHash = (title, magnetUris) => {
    const magnetData = magnetUris.sort().join('');
    const data = title + magnetData;
    return crypto.createHash('sha256').update(data).digest('hex');
};

const createCrawler = (crawledData) => {
    // --- START OF VERIFIED FIX R11 ---
    // The constructor is cleaned of any invalid state-related properties
    // that were causing the application to crash.
    return new CheerioCrawler({
    // --- END OF VERIFIED FIX R11 ---
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
                log.debug("Transforming request for proxy.", { proxy: proxyUrl, target: originalUrl });
                gotOptions.url = proxyUrl;
                gotOptions.method = 'POST';
                gotOptions.json = { pageURL: originalUrl };
            }
        ],
        async requestHandler({ request, $, crawler, response }) {
            if (!$ || typeof $.html !== 'function') {
                log.error(`Request for ${request.url} did not return valid HTML.`, { contentType: response?.headers['content-type'] });
                return;
            }
            const { label } = request;
            switch (label) {
                case 'LIST': await handleListPage({ $, crawler, request }); break;
                case 'DETAIL': await handleDetailPage({ $, request }, crawledData); break;
                default: log.error(`Unhandled request label '${label}' for URL: ${request.url}`);
            }
        },
        failedRequestHandler({ request }, error) {
            log.error(`Request ${request.url} failed and reached maximum retries.`, {
                url: request.url, retryCount: request.retryCount, error: error.message,
                statusCode: error.response?.statusCode, responseBodySnippet: error.response?.body?.toString().substring(0, 200),
            });
        }
    });
};

async function handleListPage({ $, crawler, request }) {
    const { type, catalogId } = request.userData;
    const newRequests = [];
    const detailLinkSelector = 'h4.ipsDataItem_title > span.ipsType_break > a';

    $(detailLinkSelector).each((index, element) => {
        const linkEl = $(element);
        const threadContainer = linkEl.closest('.ipsDataItem');

        if (threadContainer.length > 0) {
            const url = linkEl.attr('href');
            const raw_title = linkEl.text().trim();
            const timeEl = threadContainer.find('time[datetime]');
            const postedAt = timeEl.attr('datetime') ? new Date(timeEl.attr('datetime')) : null;

            if (url && raw_title) {
                newRequests.push({ 
                    url, 
                    label: 'DETAIL', 
                    userData: { raw_title, type, postedAt, catalogId }
                });
            }
        }
    });

    if (newRequests.length > 0) {
        log.info(`Enqueuing ${newRequests.length} detail pages of type '${type}' from catalog '${catalogId}'.`);
        await crawler.addRequests(newRequests);
    } else {
        log.warning("No detail page links found on list page. The page structure might have changed.", { url: request.url });
        try {
            const debugDir = path.join('/data', 'debug');
            await fs.mkdir(debugDir, { recursive: true });
            const sanitizedUrl = request.url.replace(/[^a-zA-Z0-9]/g, '_');
            const filename = `${new Date().toISOString()}_${sanitizedUrl}.html`;
            const filePath = path.join(debugDir, filename);
            await fs.writeFile(filePath, $.html());
            log.info(`Saved HTML of failed page to: ${filePath}`);
        } catch (e) {
            log.error("Failed to save debug HTML file.", { error: e.message });
        }
    }
}

async function handleDetailPage({ $, request }, crawledData) {
    const { userData } = request;
    const { raw_title, type, postedAt, catalogId } = userData;
    
    const magnetSelector = 'a[href^="magnet:?"]';
    const magnet_uris = $(magnetSelector).map((i, el) => $(el).attr('href')).get();

    if (magnet_uris.length > 0) {
        const thread_hash = generateThreadHash(raw_title, magnet_uris);
        crawledData.push({ thread_hash, raw_title, magnet_uris, type, postedAt, catalogId });
        log.debug("Successfully scraped detail page.", { title: raw_title, type, catalogId });
    } else {
        log.warning(`No magnet links found on detail page for "${raw_title}"`, { url: request.url });
    }
}

const runCrawler = async () => {
    // --- START OF VERIFIED FIX R11 ---
    // This command explicitly purges any default storage (Request Queues, KeyValueStores, etc.)
    // that might have persisted from a previous run within the same process.
    // This is the definitive way to ensure a completely clean slate for each crawl.
    logger.info('Purging default storages to ensure a fresh crawl...');
    await purgeDefaultStorages();
    // --- END OF VERIFIED FIX R11 ---

    const crawledData = [];
    const crawler = createCrawler(crawledData);
    const startRequests = [];
    
    const addScrapeTasks = (urls, type, catalogId) => {
        const runTimestamp = Date.now(); // Generate a single timestamp for this entire run.
        urls.forEach(baseUrl => {
            const cleanBaseUrl = baseUrl.replace(/\/$/, '');
            for (let i = config.scrapeStartPage; i <= config.scrapeEndPage; i++) {
                let url = i === 1 ? cleanBaseUrl : `${cleanBaseUrl}/page/${i}`;
                // Add a dynamic uniqueKey to each start request. This forces the crawler
                // to treat the URL as new on every run, bypassing any internal
                // deduplication checks that might persist within the process.
                startRequests.push({ 
                    url, 
                    uniqueKey: `${url}-${runTimestamp}`,
                    label: 'LIST', 
                    userData: { type, catalogId } 
                });
            }
        });
    };

    addScrapeTasks(config.seriesForumUrls, 'series', 'top-series-from-forum');
    addScrapeTasks(config.movieForumUrls, 'movie', 'tamil-hd-movies');
    addScrapeTasks(config.dubbedMovieForumUrls, 'movie', 'tamil-dubbed-movies');

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
