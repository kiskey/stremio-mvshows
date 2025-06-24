# stremio-mvshows        -- A regional content addon only.It does not works for any general purpose jackett or any kind of addon with.this is standalone addon to scrape some indian regional site for content .

Summary of V3.0 - Final Release Features
This final version is a robust, dual-mode application that functions as a high-quality P2P addon by default and can be supercharged with on-demand Real-Debrid capabilities.
Core Engine:
Automated, Self-Scheduling Crawler: The application operates autonomously on an internal 6-hour cron schedule.
Efficient Update/Skip Logic: The system intelligently re-scans pages and uses a thread-level hash comparison to efficiently skip processing any content that has not changed, saving significant resources.
Persistent & Lightweight Storage: The application uses a single, robust SQLite database file, correctly persisted via a Docker volume mount, requiring zero database administration.
Deterministic Parsing Engine:
No External Dependencies: All title and magnet parsing is handled internally by the parse-torrent-title library and a suite of custom, highly-specific regular expressions. This eliminates any reliance on external LLM APIs.
Advanced Pack Detection: The parser correctly identifies and distinguishes between single episodes, multi-episode packs (e.g., E01-E08), and full season packs.
Stremio API Implementation:
Compliant Manifest: The manifest correctly declares all capabilities, including support for series, custom meta handlers, and pagination via the skip parameter.
Paginated & Sorted Catalog: The catalog endpoint is fully paginated and serves content sorted by year (newest first, with yearless items last), providing a logical and user-friendly discovery experience.
Intelligent Stream Display: The addon does not flatten packs. A single torrent pack is represented as a single, clearly-labeled stream link in the UI (e.g., S01 | Episodes 01-08), which provides a clean and transparent user experience.
Optional Real-Debrid Integration:
Dynamic Dual-Mode: The addon functions in P2P mode by default. If a REALDEBRID_API_KEY is provided, it automatically enables the enhanced Real-Debrid workflow without requiring a database reset.
On-Demand, API-Safe Workflow: Real-Debrid interactions are triggered only by user clicks, not during background crawls. This is the most efficient and safest method, respecting API rate limits.
Seamless Polling Experience: For uncached torrents, the addon provides a placeholder stream that triggers a background polling process, resulting in a "loading" screen in Stremio until the content is ready, at which point the player is automatically redirected to the final streaming link.
Comprehensive Admin Dashboard:
Full Visibility: A fast, cached dashboard is available at the root domain, providing an at-a-glance overview of Linked, Pending, and Failed threads.
Content Curation: The UI allows for full management of pending items, including the ability to add custom posters and descriptions to improve the appearance of new content before official metadata is available.
Robust Rescue & Failure Analysis: The addon features a fully functional "Rescue" system to link pending items to official metadata and a clear table to review threads that failed critical parsing.
