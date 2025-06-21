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

const createCrawler = (crawledData) => {
    return new CheerioCrawler({
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
                    // FIX: Instead of calling a processor, we just push the results to an array
                    await handleDetailPage(context, crawledData); 
                    break;
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

async function handleDetailPage({ $, request, log }, crawledData) {
    const { userData } = request;
    const { raw_title } = userData;

    log.info(`Processing DETAIL page for: "${raw_title}"`);

    const magnetSelector = 'a[href^="magnet:?"]';
    const magnet_uris = $(magnetSelector)
        .map((i, el) => $(el).attr('href'))
        .get();

    if (magnet_uris.length > 0) {
        log.info(`Found ${magnet_uris.length} magnet links for "${raw_title}"`);
        const thread_hash = generateThreadHash(raw_title, magnet_uris);
        
        // FIX: Add the raw scraped data to our results array
        crawledData.push({ thread_hash, raw_title, magnet_uris });
    } else {
        log.warning(`No magnet links found on detail page for "${raw_title}"`);
    }
}


const runCrawler = async () => {
    // FIX: This function now collects and returns data instead of processing it.
    const crawledData = [];
    const crawler = createCrawler(crawledData);
    
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
        urls: startRequests.map(r => r.url)
    }, `Starting crawl of ${startRequests.length} pages.`);
    
    await crawler.run(startRequests);
    
    logger.info(`Crawl run has completed. Scraped ${crawledData.length} total threads.`);
    return crawledData;
};

module.exports = { runCrawler };
