// src/services/parser.js
const ptt = require('parse-torrent-title');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const config = require('../config/config');
const logger = require('../utils/logger');
const crud = require('../database/crud');

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const llm = genAI.getGenerativeModel({ 
    model: config.geminiModel,
    // Add safety settings to prevent the model from refusing to parse "violent" show titles
    safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ]
}); 

logger.info(`LLM Parser initialized with model: ${config.geminiModel}`);

const parseTitle = async (rawTitle) => {
    const parsed = ptt.parse(rawTitle);
    
    // PTN is often unreliable for complex titles, so we primarily use it as a fallback or reference.
    // The main logic will rely on the LLM, but we check PTN first.
    if (parsed.title && parsed.year) {
        logger.info({ ptt_result: parsed }, `PTT successfully parsed: ${rawTitle}`);
        // We still let the LLM try to get a cleaner title if possible, but use this as a strong default.
    }

    const prompt = `Analyze the following raw text from a forum. Extract only the TV show or movie title and its primary release year. Respond with ONLY a single, clean JSON object like {"title": "The Show Name", "year": 2023} and absolutely nothing else. Raw text: "${rawTitle}"`;

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
    // Fallback to PTN result if LLM fails
    if (parsed.title && parsed.year) {
        return { clean_title: parsed.title, year: parsed.year };
    }
    return null;
};

const parseMagnet = async (magnetUri) => {
    try {
        const params = new URLSearchParams(magnetUri.split('?')[1]);
        const infohash = params.get('xt')?.replace('urn:btih:', '');
        const filename = params.get('dn') || infohash;

        if (!infohash) {
            logger.warn('Magnet URI missing infohash (xt parameter)');
            return null;
        }

        const prompt = `Analyze the torrent filename below. Extract the metadata. Respond with ONLY a clean JSON object and nothing else. The 'episodes' field must be an array of numbers. If it's a range like "E01-E05", list all numbers in the array. Filename: "${filename}"\n\nExample JSON Response: {"season": 1, "episodes": [1, 2, 3, 4, 5], "quality": "1080p", "language": "English"}`;
        
        const result = await llm.generateContent(prompt);
        const responseText = result.response.text().replace(/```json|```/g, '').trim();
        await crud.logLlmCall('magnet', prompt, responseText);
        const data = JSON.parse(responseText);
        
        if (!data.season || !data.episodes || !Array.isArray(data.episodes) || data.episodes.length === 0) {
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
        const shortMagnet = magnetUri.substring(0, 70);
        logger.error({ err: e, magnet: `${shortMagnet}...` }, `LLM magnet parsing failed`);
        return null;
    }
};

module.exports = { parseTitle, parseMagnet };
