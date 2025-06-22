// src/database/crud.js
const { models } = require('./connection');
const { Op } = require('sequelize');

const findThreadByHash = (hash) => models.Thread.findByPk(hash);

const createOrUpdateThread = (data) => {
    return models.Thread.upsert(data, {
        conflictFields: ['thread_hash'] 
    });
};

const logFailedThread = (hash, raw_title, reason) => models.FailedThread.upsert({ thread_hash: hash, raw_title, reason, last_attempt: new Date() });

// FIX: Ensure this function returns all the necessary fields from the stream model.
// Using `raw: true` is a good practice for read-only queries.
const findStreams = (tmdb_id, season, episode) => models.Stream.findAll({
    where: { tmdb_id, season, episode },
    order: [['quality', 'DESC']], 
    raw: true, // Return plain data objects
});

const createStreams = (streams) => models.Stream.bulkCreate(streams, { ignoreDuplicates: true });

module.exports = {
    findThreadByHash,
    createOrUpdateThread,
    logFailedThread,
    findStreams,
    createStreams,
};
