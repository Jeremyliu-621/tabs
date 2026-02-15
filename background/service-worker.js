/**
 * Tabs — Background Service Worker
 *
 * Entry point for the extension's background process.
 * Initializes passive tab tracking.
 */

import { startTracking } from './tracker.js';

// ── Initialization ───────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[Tabs] Extension installed — tracking begins.');
    } else if (details.reason === 'update') {
        console.log(`[Tabs] Extension updated to v${chrome.runtime.getManifest().version}`);
    }
});

// Start tracking immediately when the service worker spins up
startTracking();
