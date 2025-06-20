// src/utils/logger.js
const pino = require('pino');
const config = require('../config/config');

const logger = pino({
    level: config.logLevel,
    transport: process.env.NODE_ENV !== 'production' 
        ? { target: 'pino-pretty' } 
        : undefined,
});

module.exports = logger;
