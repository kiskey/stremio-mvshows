// src/database/models.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Thread = sequelize.define('Thread', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, // Add a simple ID for easy reference
        thread_hash: { type: DataTypes.STRING, unique: true, allowNull: false },
        raw_title: { type: DataTypes.STRING, allowNull: false },
        clean_title: DataTypes.STRING,
        year: DataTypes.INTEGER,
        tmdb_id: { type: DataTypes.STRING, references: { model: 'TmdbMetadata', key: 'tmdb_id' }, allowNull: true }, // Allow NULL for pending
        
        // NEW: Status to track the state of the thread
        status: { 
            type: DataTypes.STRING, 
            defaultValue: 'linked', // 'linked', 'pending_tmdb', 'failed_parse'
            allowNull: false
        },
        
        // NEW: Store magnets here for pending threads so we can re-process them later
        magnet_uris: {
            type: DataTypes.JSON,
            allowNull: true
        },
        
        last_seen: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    }, { tableName: 'threads', timestamps: true }); // Enable timestamps for better sorting


    const TmdbMetadata = sequelize.define('TmdbMetadata', {
        tmdb_id: { type: DataTypes.STRING, primaryKey: true },
        imdb_id: { type: DataTypes.STRING, unique: true },
        data: { type: DataTypes.JSON, allowNull: false },
    }, { tableName: 'tmdb_metadata', timestamps: false });
    
    // No imdb_mapping table needed; imdb_id is in TmdbMetadata

    const Stream = sequelize.define('Stream', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        tmdb_id: { type: DataTypes.STRING, allowNull: false, index: true },
        season: { type: DataTypes.INTEGER, allowNull: false },
        episode: { type: DataTypes.INTEGER, allowNull: false },
        infohash: { type: DataTypes.STRING, allowNull: false },
        quality: DataTypes.STRING,
        language: DataTypes.STRING,
    }, { 
        tableName: 'streams', 
        timestamps: false,
        indexes: [{ unique: true, fields: ['tmdb_id', 'season', 'episode', 'infohash'] }]
    });

    const FailedThread = sequelize.define('FailedThread', {
        thread_hash: { type: DataTypes.STRING, primaryKey: true },
        raw_title: DataTypes.STRING,
        reason: DataTypes.STRING,
        last_attempt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    }, { tableName: 'failed_threads', timestamps: false });

    const LlmLog = sequelize.define('LlmLog', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        source: DataTypes.STRING, // "title" or "magnet"
        input_prompt: DataTypes.TEXT,
        llm_response: DataTypes.TEXT,
    }, { tableName: 'llm_logs', timestamps: false });

    return { Thread, TmdbMetadata, Stream, FailedThread, LlmLog };
};
