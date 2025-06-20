// src/database/crud.js
const { models } = require('./connection');

const findThreadByHash = (hash) => models.Thread.findByPk(hash);

const createOrUpdateThread = (data) => models.Thread.upsert(data);

const logFailedThread = (hash, raw_title, reason) => models.FailedThread.upsert({ thread_hash: hash, raw_title, reason, last_attempt: new Date() });

const findStreams = (tmdb_id, season, episode) => models.Stream.findAll({
    where: { tmdb_id, season, episode },
    order: [['quality', 'DESC']], // Example sorting
});

const createStreams = (streams) => models.Stream.bulkCreate(streams, { ignoreDuplicates: true });

const logLlmCall = (source, input_prompt, llm_response) => models.LlmLog.create({ source, input_prompt, llm_response });

// ... other CRUD functions as needed

module.exports = {
    findThreadByHash,
    createOrUpdateThread,
    logFailedThread,
    findStreams,
    createStreams,
    logLlmCall,
    // ...
};
