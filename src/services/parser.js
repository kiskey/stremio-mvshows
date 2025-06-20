// src/services/parser.js
const ptt = require('parse-torrent-title');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require('../config/config');
const logger = require('../utils/logger');
const crud = require('../database/crud');

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
// --- USE CONFIGURABLE MODEL ---
const llm = genAI.getGenerativeModel({ model: config.geminiModel }); 

logger.info(`LLM Parser initialized with model: ${config.geminiModel}`);

const parseTitle = async (rawTitle) => {
    const parsed = ptt.parse(rawTitle);
    
    if (parsed.title && parsed.year) {
        logger.info({ ptt_result: parsed }, `PTT successfully parsed: ${rawTitle}`);
        return { clean_title: parsed.title, year: parsed.year };
    }

    logger.warn(`PTT failed for "${rawTitle}", falling back to LLM.`);
    const prompt = `Given the raw text, extract the TV show or movie title and its release year. Respond with only a clean JSON object like {"title": "The Show Name", "year": 2023}. Raw text: "${rawTitle}"`;

    try {
        const result = await llm.generateContent(prompt);
        const responseText = result.response.text().replace(/```json|```/g, '').trim();
        await crud.logLlmCall('title', prompt, responseText);
        const data = JSON.parse(responseText);
        
        if (data.title && data.year) {
            logger.info({ llm_result: data }, `LLM successfully parsed title`);
            return { clean_title: data.title, year: parseInt(data.year) };
        }
    } catch (e) {
        logger.error(e, 'LLM title parsing failed');
    }
    return null;
};

const parseMagnet = async (magnetUri) => {
    try {
        const params = new URLSearchParams(magnetUri.split('?')[1]);
        const infohash = params.get('xt').replace('urn:btih:', '');
        const filename = params.get('dn') || infohash;

        const prompt = `Analyze the torrent filename and extract metadata. Respond with only a clean JSON object. The 'episodes' field must be an array of numbers. Filename: "${filename}"\n\nExample Response: {"season": 1, "episodes": [1, 2, 3], "quality": "1080p", "language": "English"}`;

        const result = await llm.generateContent(prompt);
        const responseText = result.response.text().replace(/```json|```/g, '').trim();
        await crud.logLlmCall('magnet', prompt, responseText);
        const data = JSON.parse(responseText);

        if (!data.season || !data.episodes || !Array.isArray(data.episodes)) {
             throw new Error("LLM response missing required fields or incorrect format.");
        }
        
        return {
            infohash,
            season: data.season,
            episodes: data.episodes,
            quality: data.quality || 'SD',
            language: data.language || 'Unknown',
        };
    } catch (e) {
        logger.error(e, `LLM magnet parsing failed for magnet: ${magnetUri.substring(0, 50)}`);
        return null;
    }
};

module.exports = { parseTitle, parseMagnet };
