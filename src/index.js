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

const stremioRoutes = require('./api/stremio.routes');
const adminRoutes = require('./api/admin.routes');

const app = express();

/**
 * The main entry point for the application.
 * This function orchestrates the startup sequence.
 */
async function main() {
    // 1. Initialize Database: Ensure tables are created or updated.
    await syncDb();
    logger.info('Database synchronized successfully.');

    // 2. Start the Express API Server:
    // The API must be running continuously to serve requests from Stremio and admins.
    app.use(cors()); // Enable Cross-Origin Resource Sharing
    app.use(express.json()); // Enable JSON body parsing for POST requests
    app.use(pinoHttp({ logger })); // Add structured logging for all HTTP requests

    // --- Define Routes ---
    
    // FIX: Serve the admin dashboard on the root URL
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
    });

    // Also serve the admin UI at /admin for a consistent user experience
    app.get('/admin', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
    });

    // Register API route handlers
    app.use(stremioRoutes); // Public Stremio routes (manifest, catalog, stream)
    app.use('/admin/api', adminRoutes); // Private admin API routes, now namespaced to avoid conflicts

    // Start listening for requests
    app.listen(config.port, () => {
        logger.info(`Stremio Addon server running on http://localhost:${config.port}`);
    });
    
    // 3. Perform an initial crawl on application startup
    logger.info('Performing initial crawl on startup...');
    runFullWorkflow();
    
    // 4. Schedule the recurring crawl using node-cron
    const schedule = '0 */6 * * *'; // Every 6 hours
    
    cron.schedule(schedule, () => {
        logger.info(`Cron job triggered by schedule (${schedule}). Starting workflow...`);
        runFullWorkflow();
    }, {
        scheduled: true,
        timezone: "Etc/UTC"
    });
    
    logger.info(`Crawler is now scheduled to run automatically on schedule: "${schedule}" (UTC).`);
}

// --- Start Application ---
main().catch(err => {
    logger.fatal(err, 'Application failed to start due to a fatal error.');
    process.exit(1);
});
