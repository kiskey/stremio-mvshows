// src/index.js
const express = require('express');
const cors = require('cors');
const pinoHttp = require('pino-http');
const config = require('./config/config');
const logger = require('./utils/logger');
const { syncDb } = require('./database/connection');
const stremioRoutes = require('./api/stremio.routes');
const adminRoutes = require('./api/admin.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

// Routes
app.get('/', (req, res) => {
    res.redirect('/manifest.json');
});
app.use(stremioRoutes); // Stremio routes at root
app.use('/admin', adminRoutes); // Admin routes prefixed

const startServer = async () => {
    await syncDb();
    app.listen(config.port, () => {
        logger.info(`Stremio Addon server running on http://localhost:${config.port}`);
    });
};

startServer();
