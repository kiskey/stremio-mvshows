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
                logger.debug({ proxy: proxyUrl, target: originalUrl }, "Transforming request for proxy.");
                gotOptions.url = proxyUrl;
                gotOptions.method = 'POST';
                gotOptions.json = { pageURL: originalUrl };
            }
        ],

        async requestHandler(context) {
            const { request, log, $ } = context;
            if (!$ || typeof $.html !== 'function') {
                log.error(`Request for ${request.url} did not return valid HTML.`, { contentType: context.response?.headers['content-type'] });
                return;
            }
            const { label } = request;
            switch (label) {
                case 'LIST': await handleListPage(context); break;
                case 'DETAIL': await handleDetailPage(context, crawledData); break;
                default: log.error(`Unhandled request label '${label}' for URL: ${request.url}`);
            }
        },

        failedRequestHandler({ request, log}, error ) {
            log.error(`Request ${request.url} failed and reached maximum retries.`, {
                url: request.url, retryCount: request.retryCount, error: error.message,
                statusCode: error.response?.statusCode, responseBodySnippet: error.response?.body?.toString().substring(0, 200),
            });
        }
    });
};

async function handleListPage({ $, log, crawler, request }) {
    // The type ('movie' or 'series') is passed in userData from the initial request
    const { type } = request.userData;

    const detailLinkSelector = 'h4.ipsDataItem_title > span.ipsType_break > a';
    const newRequests = [];

    $('div[data-rowid]').each((index, element) => {
        const row = $(element);
        const linkEl = row.find(detailLinkSelector);
        const url = linkEl.attr('href');
        const raw_title = linkEl.text().trim();

        // NEW: Parse the postedAt timestamp
        const timeEl = row.find('time[datetime]');
        const postedAt = timeEl.attr('datetime') ? new Date(timeEl.attr('datetime')) : null;

        if (url && raw_title) {
            newRequests.push({ 
                url, 
                label: 'DETAIL', 
                userData: { raw_title, type, postedAt } // Pass type and postedAt to detail page
            });
        }
    });

    if (newRequests.length > 0) {
        log.info(`Enqueuing ${newRequests.length} detail pages of type '${type}' from list page.`);
        await crawler.addRequests(newRequests);
    }
}

async function handleDetailPage({ $, request, log }, crawledData) {
    const { userData } = request;
    const { raw_title, type, postedAt } = userData; // Receive type and postedAt
    
    const magnetSelector = 'a[href^="magnet:?"]';
    const magnet_uris = $(magnetSelector).map((i, el) => $(el).attr('href')).get();

    if (magnet_uris.length > 0) {
        const thread_hash = generateThreadHash(raw_title, magnet_uris);
        crawledData.push({ thread_hash, raw_title, magnet_uris, type, postedAt }); // Add type and postedAt to final data
        logger.debug({ title: raw_title, type, postedAt }, "Successfully scraped detail page.");
    } else {
        log.warning(`No magnet links found on detail page for "${raw_title}"`);
    }
}

const runCrawler = async () => {
    const crawledData = [];
    const crawler = createCrawler(crawledData);
    const startRequests = [];
    
    // This function adds scrape tasks for a given set of URLs and a type
    const addScrapeTasks = (urls, type) => {
        urls.forEach(baseUrl => {
            const cleanBaseUrl = baseUrl.replace(/\/$/, '');
            for (let i = config.scrapeStartPage; i <= config.scrapeEndPage; i++) {
                let url = i === 1 ? cleanBaseUrl : `${cleanBaseUrl}/page/${i}`;
                startRequests.push({ url, label: 'LIST', userData: { type } });
            }
        });
    };

    // Build the full list of requests from all configured sources
    addScrapeTasks(config.seriesForumUrls, 'series');
    addScrapeTasks(config.movieForumUrls, 'movie');
    addScrapeTasks(config.dubbedMovieForumUrls, 'movie'); // Dubbed movies are still type 'movie'

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
