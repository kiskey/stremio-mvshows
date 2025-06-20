// src/utils/logger.js
const pino = require('pino');
const config = require('../config/config');

const isProduction = process.env.NODE_ENV === 'production';

const logger = pino({
    level: config.logLevel,
    // Use pino-pretty only when NOT in production
    transport: !isProduction
        ? { target: 'pino-pretty' }
        : undefined,
});

module.exports = logger;
