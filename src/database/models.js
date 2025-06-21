// src/database/models.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Thread = sequelize.define('Thread', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        thread_hash: { type: DataTypes.STRING, unique: true, allowNull: false },
        raw_title: { type: DataTypes.STRING, allowNull: false },
        clean_title: DataTypes.STRING,
        year: DataTypes.INTEGER,
        tmdb_id: { 
            type: DataTypes.STRING, 
            references: { model: 'tmdb_metadata', key: 'tmdb_id' }, 
            allowNull: true 
        },
        status: { 
            type: DataTypes.STRING, 
            defaultValue: 'linked',
            allowNull: false
        },
        magnet_uris: { type: DataTypes.JSON, allowNull: true },
        last_seen: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    }, { tableName: 'threads', timestamps: true });

    const TmdbMetadata = sequelize.define('TmdbMetadata', {
        tmdb_id: { type: DataTypes.STRING, primaryKey: true },
        imdb_id: { type: DataTypes.STRING, unique: true },
        data: { type: DataTypes.JSON, allowNull: false },
    }, { tableName: 'tmdb_metadata', timestamps: true });
    
    const Stream = sequelize.define('Stream', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        tmdb_id: { type: DataTypes.STRING, allowNull: false },
        season: { type: DataTypes.INTEGER, allowNull: false },
        episode: { type: DataTypes.INTEGER, allowNull: false },
        infohash: { type: DataTypes.STRING, allowNull: false },
        quality: DataTypes.STRING,
        language: DataTypes.STRING,
    }, { 
        tableName: 'streams', 
        timestamps: false,
        // FIX: This is the final, correct constraint for a stream.
        indexes: [{ 
            unique: true, 
            fields: ['tmdb_id', 'season', 'episode', 'infohash'] 
        }]
    });

    const FailedThread = sequelize.define('FailedThread', {
        thread_hash: { type: DataTypes.STRING, primaryKey: true },
        raw_title: DataTypes.STRING,
        reason: DataTypes.STRING,
        last_attempt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    }, { tableName: 'failed_threads', timestamps: false });
    
    return { Thread, TmdbMetadata, Stream, FailedThread };
};
