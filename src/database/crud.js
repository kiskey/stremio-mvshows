// src/database/crud.js
const { models } = require('./connection');
const { Op } = require('sequelize');

const findThreadByHash = (hash) => models.Thread.findByPk(hash);

const createOrUpdateThread = (data) => {
    return models.Thread.upsert(data, {
        // Add a conflict target to be safe, though our orchestrator logic handles this
        conflictFields: ['thread_hash'] 
    });
};

const logFailedThread = (hash, raw_title, reason) => models.FailedThread.upsert({ thread_hash: hash, raw_title, reason, last_attempt: new Date() });

// CORRECTED: Added sorting logic to prioritize higher quality streams
const findStreams = (tmdb_id, season, episode) => models.Stream.findAll({
    where: { tmdb_id, season, episode },
    // A simple quality sort. Can be made more advanced later.
    order: [['quality', 'DESC']], 
});

const createStreams = (streams) => models.Stream.bulkCreate(streams, { ignoreDuplicates: true });

const logLlmCall = (source, input_prompt, llm_response) => models.LlmLog.create({ source, input_prompt, llm_response });

module.exports = {
    findThreadByHash,
    createOrUpdateThread,
    logFailedThread,
    findStreams,
    createStreams,
    logLlmCall,
};
