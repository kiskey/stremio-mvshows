// src/database/models.js
const { DataTypes } = require('sequelize');
const config = require('../config/config'); // Import config for the helper method

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
        custom_poster: { type: DataTypes.STRING, allowNull: true },
        custom_description: { type: DataTypes.TEXT, allowNull: true },
        last_seen: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    }, { tableName: 'threads', timestamps: true });

    const TmdbMetadata = sequelize.define('TmdbMetadata', {
        tmdb_id: { type: DataTypes.STRING, primaryKey: true },
        imdb_id: { type: DataTypes.STRING, unique: true },
        year: { type: DataTypes.INTEGER, index: true },
        data: { type: DataTypes.JSON, allowNull: false },
    }, { tableName: 'tmdb_metadata', timestamps: true });
    
    const Stream = sequelize.define('Stream', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        tmdb_id: { type: DataTypes.STRING, allowNull: false },
        season: { type: DataTypes.INTEGER, allowNull: false },
        
        // FIX: Added start and end episodes to support packs
        episode: { type: DataTypes.INTEGER, allowNull: false, comment: "Starting episode number" },
        episode_end: { type: DataTypes.INTEGER, allowNull: true, comment: "Ending episode number, same as episode for single episodes" },
        
        infohash: { type: DataTypes.STRING, allowNull: false },
        quality: DataTypes.STRING,
        language: DataTypes.STRING,
    }, { 
        tableName: 'streams', 
        timestamps: true, // Use timestamps to know when streams were added
        indexes: [{ 
            unique: true, 
            // The unique key is now the hash and the start episode, preventing duplicate pack entries
            fields: ['tmdb_id', 'season', 'episode', 'infohash'] 
        }]
    });

    // Add a helper method to the Stream model instance to format its Stremio response
    Stream.prototype.toStreamObject = function() {
        const seasonStr = String(this.season).padStart(2, '0');
        let episodeStr;

        if (!this.episode_end || this.episode_end === this.episode) {
            // It's a single episode
            episodeStr = `Episode ${String(this.episode).padStart(2, '0')}`;
        } else if (this.episode === 1 && this.episode_end === 999) {
            // It's a full season pack
            episodeStr = 'Season Pack';
        } else {
            // It's an episode pack
            episodeStr = `Episodes ${String(this.episode).padStart(2, '0')}-${String(this.episode_end).padStart(2, '0')}`;
        }

        return {
            infoHash: this.infohash,
            name: `[TamilMV] - ${this.quality} 📺`,
            title: `S${seasonStr} | ${episodeStr}\n${this.quality || 'SD'} | ${this.language || 'N/A'}`,
            sources: config.trackers
        };
    };

    const FailedThread = sequelize.define('FailedThread', {
        thread_hash: { type: DataTypes.STRING, primaryKey: true },
        raw_title: DataTypes.STRING,
        reason: DataTypes.STRING,
        last_attempt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    }, { tableName: 'failed_threads', timestamps: false });
    
    return { Thread, TmdbMetadata, Stream, FailedThread };
};
