// src/index.js
const express = require('express');
const cors = require('cors');
const pinoHttp = require('pino-http');
const cron = require('node-cron');
const path = require('path');

const config = require('./config/config');
const logger = require('./utils/logger');
const { syncDb } = require('./database/connection');
const { runFullWorkflow } = require('./services/orchestrator');
const { fetchAndCacheTrackers } = require('./services/tracker'); // FIX: Import tracker service

const stremioRoutes = require('./api/stremio.routes');
const adminRoutes = require('./api/admin.routes');

const app = express();

async function main() {
    await syncDb();
    logger.info('Database synchronized successfully.');

    // FIX: Perform an initial fetch of trackers on startup
    await fetchAndCacheTrackers();

    app.use(cors());
    app.use(express.json());
    app.use(pinoHttp({ logger }));

    app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
    app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
    app.use(stremioRoutes);
    app.use('/admin/api', adminRoutes);

    app.listen(config.port, () => {
        logger.info(`Stremio Addon server running on http://localhost:${config.port}`);
    });
    
    // Start the crawl workflow
    runFullWorkflow();
    
    // Schedule recurring jobs
    cron.schedule('0 */6 * * *', () => {
        logger.info('Cron job triggered for main workflow...');
        runFullWorkflow();
    }, { scheduled: true, timezone: "Etc/UTC" });

    // FIX: Schedule recurring tracker updates
    cron.schedule('0 * * * *', () => { // Every hour at minute 0
        logger.info('Cron job triggered for tracker update...');
        fetchAndCacheTrackers();
    }, { scheduled: true, timezone: "Etc/UTC" });
    
    logger.info(`Crawler scheduled for every 6 hours. Tracker list scheduled to update every hour.`);
}

main().catch(err => {
    logger.fatal(err, 'Application failed to start due to a fatal error.');
    process.exit(1);
});
