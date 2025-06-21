// src/database/connection.js
const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');
const defineModels = require('./models');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    // FIX: Use the absolute path to the data volume we mounted in Docker.
    // This ensures the database file is written to the persistent storage location.
    storage: '/data/stremio_addon.db',
    logging: msg => logger.debug(msg),
});

const models = defineModels(sequelize);

// Define associations between models
if (models.Thread && models.TmdbMetadata) {
    models.Thread.belongsTo(models.TmdbMetadata, { foreignKey: 'tmdb_id', targetKey: 'tmdb_id' });
    models.TmdbMetadata.hasMany(models.Thread, { foreignKey: 'tmdb_id', sourceKey: 'tmdb_id' });
}

const syncDb = async () => {
    try {
        await sequelize.sync({ alter: true });
        logger.info('Database & tables created!');
    } catch (error) {
        logger.error(error, 'Error synchronizing database:');
    }
};

module.exports = { sequelize, models, syncDb };
