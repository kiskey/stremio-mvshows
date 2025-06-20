// src/database/connection.js
const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');
const defineModels = require('./models');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './stremio_addon.db',
    logging: msg => logger.debug(msg),
});

const models = defineModels(sequelize);

// Define associations
models.Thread.belongsTo(models.TmdbMetadata, { foreignKey: 'tmdb_id', targetKey: 'tmdb_id' });
models.TmdbMetadata.hasMany(models.Thread, { foreignKey: 'tmdb_id', sourceKey: 'tmdb_id' });

const syncDb = async () => {
    try {
        await sequelize.sync({ alter: true }); // 'alter: true' avoids data loss on schema changes
        logger.info('Database & tables created!');
    } catch (error) {
        logger.error('Error synchronizing database:', error);
    }
};

module.exports = { sequelize, models, syncDb };
