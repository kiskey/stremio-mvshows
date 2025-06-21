// src/services/parser.js
const ptt = require('parse-torrent-title');
// FIX: Use the new, correct Google AI SDK
const { GoogleAI, HarmCategory, HarmBlockThreshold } = require("@google/genai"); 
const config = require('../config/config');
const logger = require('../utils/logger');
const crud = require('../database/crud');

// FIX: Initialize with the new, simpler constructor
const genAI = new GoogleAI(config.geminiApiKey); 

const llm = genAI.getGenerativeModel({ 
    model: config.geminiModel,
    // Safety settings prevent the model from refusing to parse titles it deems sensitive
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
    
    if (parsed.title && parsed.year) {
        logger.info({ ptt_result: parsed }, `PTT successfully parsed: ${rawTitle}`);
    }

    // IMPROVEMENT: More robust prompt engineering
    const prompt = `Analyze the raw text below. Extract the TV show or movie title and its release year. Respond with ONLY a valid JSON object like {"title": "The Show Name", "year": 2023}. Do not include the \`\`\`json markdown wrapper. Raw text: "${rawTitle}"`;

    try {
        const result = await llm.generateContent(prompt);
        // The new SDK recommends using `result.response.text()`
        const responseText = result.response.text(); 
        await crud.logLlmCall('title', prompt, responseText);
        const data = JSON.parse(responseText.trim());
        
        if (data.title && data.year) {
            logger.info({ llm_result: data }, `LLM successfully parsed title`);
            return { clean_title: data.title, year: parseInt(data.year) };
        }
    } catch (e) {
        logger.error(e, 'LLM title parsing failed');
    }
    
    // Fallback to PTN result if the LLM fails
    if (parsed.title && parsed.year) {
        logger.warn('LLM failed, falling back to PTT result for title parsing.');
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

        // IMPROVEMENT: More robust prompt engineering
        const prompt = `Analyze the torrent filename below. Extract the metadata. Respond with ONLY a valid JSON object. The 'episodes' field must be an array of numbers. If the filename indicates a range like "E01-E05", list all numbers in the array. Do not include the \`\`\`json markdown wrapper. Filename: "${filename}"\n\nExample JSON Response: {"season": 1, "episodes": [1, 2, 3, 4, 5], "quality": "1080p", "language": "English"}`;
        
        const result = await llm.generateContent(prompt);
        const responseText = result.response.text();
        await crud.logLlmCall('magnet', prompt, responseText);
        const data = JSON.parse(responseText.trim());
        
        if (!data.season || !data.episodes || !Array.isArray(data.episodes) || data.episodes.length === 0) {
             throw new Error("LLM response missing required fields or has an incorrect format.");
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
