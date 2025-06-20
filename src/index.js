// src/index.js
const express = require('express');
const cors = require('cors');
const pinoHttp = require('pino-http');
const cron = require('node-cron');

const config = require('./config/config');
const logger = require('./utils/logger');
const { syncDb } = require('./database/connection');
const { runFullWorkflow, isCrawling } = require('./services/orchestrator');

const stremioRoutes = require('./api/stremio.routes');
const adminRoutes = require('./api/admin.routes');

const app = express();

// --- Main Application Logic ---
async function main() {
    // 1. Initialize Database
    await syncDb();
    logger.info('Database synchronized.');

    // 2. Start the Express API Server
    // The API must be running to serve Stremio requests at all times.
    app.use(cors());
    app.use(express.json());
    app.use(pinoHttp({ logger }));

    app.get('/', (req, res) => res.redirect('/manifest.json'));
    app.use(stremioRoutes);
    app.use('/admin', adminRoutes);

    app.listen(config.port, () => {
        logger.info(`Stremio Addon server running on http://localhost:${config.port}`);
    });
    
    // 3. Perform an initial crawl on startup
    logger.info('Performing initial crawl on startup...');
    await runFullWorkflow();
    logger.info('Initial crawl finished.');
    
    // 4. Schedule the recurring crawl
    const schedule = '0 */6 * * *'; // Every 6 hours
    cron.schedule(schedule, () => {
        logger.info(`Cron job triggered (${schedule}). Starting scheduled workflow...`);
        runFullWorkflow();
    }, {
        scheduled: true,
        timezone: "Etc/UTC"
    });
    
    logger.info(`Crawler scheduled to run every 6 hours (UTC).`);
}

main().catch(err => {
    logger.fatal(err, 'Application failed to start');
    process.exit(1);
});
