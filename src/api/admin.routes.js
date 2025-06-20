// src/api/admin.routes.js
const express = require('express');
const router = express.Router();
const { runFullWorkflow, isCrawling } = require('../services/orchestrator');
const { models } = require('../database/connection');

router.post('/trigger-crawl', (req, res) => {
    if (isCrawling()) {
        return res.status(429).json({ message: "Crawl is already in progress." });
    }
    // Run in background, don't await
    runFullWorkflow(); 
    res.status(202).json({ message: "Crawl workflow triggered successfully." });
});

router.get('/debug/failures', async (req, res) => {
    const failures = await models.FailedThread.findAll();
    res.json(failures);
});

// ... other admin endpoints like /rescue, /submit-title

module.exports = router;
