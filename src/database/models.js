// src/database/models.js
const { DataTypes } = require('sequelize');
const config = require('../config/config');

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
        status: { type: DataTypes.STRING, defaultValue: 'linked', allowNull: false },
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
        episode: { type: DataTypes.INTEGER, allowNull: false, comment: "Starting episode number" },
        episode_end: { type: DataTypes.INTEGER, allowNull: true, comment: "Ending episode number, same as episode for single episodes" },
        infohash: { type: DataTypes.STRING, allowNull: false },
        quality: DataTypes.STRING,
        language: DataTypes.STRING,
    }, { 
        tableName: 'streams', 
        timestamps: true,
        indexes: [{ 
            unique: true, 
            fields: ['tmdb_id', 'season', 'episode', 'infohash'] 
        }]
    });

    const Hash = sequelize.define('Hash', {
        infohash: { type: DataTypes.STRING, primaryKey: true },
        is_rd_cached: { type: DataTypes.BOOLEAN, defaultValue: false },
        last_checked: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    }, { tableName: 'hashes', timestamps: true });
    
    // FIX: Only create relationships if RD is enabled
    if (config.isRdEnabled) {
        Stream.belongsTo(Hash, { foreignKey: 'infohash', targetKey: 'infohash' });
        Hash.hasMany(Stream, { foreignKey: 'infohash', sourceKey: 'infohash' });
    }

    Stream.prototype.toStreamObject = function() {
        const seasonStr = String(this.season).padStart(2, '0');
        let episodeStr;

        if (!this.episode_end || this.episode_end === this.episode) {
            episodeStr = `Episode ${String(this.episode).padStart(2, '0')}`;
        } else if (this.episode === 1 && this.episode_end === 999) {
            episodeStr = 'Season Pack';
        } else {
            episodeStr = `Episodes ${String(this.episode).padStart(2, '0')}-${String(this.episode_end).padStart(2, '0')}`;
        }
        
        // Default P2P name and title
        let name = `[TamilMV] - ${this.quality || 'SD'} 📺`;
        let title = `S${seasonStr} | ${episodeStr}\n${this.quality || 'SD'} | ${this.language || 'N/A'}`;

        // Overwrite with RD info if available
        if (config.isRdEnabled && this.Hash) {
            name = this.Hash.is_rd_cached ? `[RD+ Cached] ⚡️` : `[RD Uncached] ⏳`;
            name += ` ${this.quality || 'SD'}`;
            title = `S${seasonStr} | ${episodeStr}\n${this.quality || 'SD'} | ${this.language || 'N/A'}`;
        }

        return { infoHash: this.infohash, name, title };
    };

    const FailedThread = sequelize.define('FailedThread', {
        thread_hash: { type: DataTypes.STRING, primaryKey: true },
        raw_title: DataTypes.STRING,
        reason: DataTypes.STRING,
        last_attempt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    }, { tableName: 'failed_threads', timestamps: false });
    
    return { Thread, TmdbMetadata, Stream, FailedThread, Hash };
};
