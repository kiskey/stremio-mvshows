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
        tmdb_id: { type: DataTypes.STRING, references: { model: 'tmdb_metadata', key: 'tmdb_id' }, allowNull: true },
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
        episode: { type: DataTypes.INTEGER, allowNull: false, comment: "Starting episode number of a pack" },
        episode_end: { type: DataTypes.INTEGER, allowNull: true, comment: "Ending episode number of a pack" },
        infohash: { type: DataTypes.STRING, allowNull: false },
        quality: DataTypes.STRING,
        language: DataTypes.STRING,
        rd_id: { type: DataTypes.STRING, allowNull: true, comment: "RD torrent ID, for polling" },
        rd_status: { type: DataTypes.STRING, allowNull: true, comment: "Status of the torrent on RD" },
    }, { 
        tableName: 'streams', 
        timestamps: true,
        indexes: [{ unique: true, fields: ['tmdb_id', 'season', 'episode', 'infohash'] }]
    });

    // NEW TABLE: Stores the final, specific link for each episode.
    const UnrestrictedLink = sequelize.define('UnrestrictedLink', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        stream_id: { type: DataTypes.INTEGER, references: { model: 'streams', key: 'id' }, allowNull: false },
        episode: { type: DataTypes.INTEGER, allowNull: false },
        link: { type: DataTypes.STRING, allowNull: false },
        expiresAt: { type: DataTypes.DATE, allowNull: false },
    }, { 
        tableName: 'unrestricted_links',
        timestamps: true,
        indexes: [{ unique: true, fields: ['stream_id', 'episode'] }]
    });

    Stream.hasMany(UnrestrictedLink, { foreignKey: 'stream_id' });
    UnrestrictedLink.belongsTo(Stream, { foreignKey: 'stream_id' });

    const FailedThread = sequelize.define('FailedThread', {
        thread_hash: { type: DataTypes.STRING, primaryKey: true },
        raw_title: DataTypes.STRING,
        reason: DataTypes.STRING,
        last_attempt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    }, { tableName: 'failed_threads', timestamps: false });
    
    return { Thread, TmdbMetadata, Stream, FailedThread, UnrestrictedLink };
};
