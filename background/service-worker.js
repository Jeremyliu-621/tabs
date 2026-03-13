/**
 * Tabs — Background Service Worker
 *
 * Entry point for the extension's background process.
 * Initializes passive tab tracking and periodic clustering.
 */

import { startTracking } from './tracker.js';
import { runClustering } from './clustering.js';
import { runAIClustering, checkAndRunAIClustering } from './ai-clustering.js';

// ── Initialization ───────────────────────────────────────────

// Manually open the side panel when the extension action icon is clicked.
// This is more reliable than setPanelBehavior during extension reloads.
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[Tabs] Extension installed — tracking begins.');
    } else if (details.reason === 'update') {
        console.log(`[Tabs] Extension updated to v${chrome.runtime.getManifest().version}`);
    }

    // Run initial AI clustering after a short delay
    setTimeout(() => runAIClustering(true), 3000);
});

// Start tracking immediately when the service worker spins up
startTracking();

// ── Smart trigger clustering ──────────────────────────────────

// Check for clustering triggers on tab events
chrome.tabs.onCreated.addListener(() => {
    checkAndRunAIClustering();
});

chrome.tabs.onUpdated.addListener(() => {
    checkAndRunAIClustering();
});

// ── Message handling (popup → background) ────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'runClustering') {
        // Legacy: use heuristic clustering
        runClustering()
            .then((projects) => sendResponse({ success: true, projects }))
            .catch((err) => sendResponse({ success: false, error: err.message }));
        return true; // async response
    }

    if (msg.action === 'runAIClustering') {
        // New: use AI clustering (with fallback)
        runAIClustering(true) // Force analysis
            .then((projects) => sendResponse({ success: true, projects }))
            .catch((err) => sendResponse({ success: false, error: err.message }));
        return true; // async response
    }

    if (msg.action === 'getCachedProjects') {
        // Return cached projects for instant popup display
        import('./cache.js').then(({ getCachedProjects }) => {
            getCachedProjects()
                .then((cache) => sendResponse({ success: true, cache }))
                .catch((err) => sendResponse({ success: false, error: err.message }));
        });
        return true; // async response
    }

    if (msg.action === 'openTabs') {
        const urls = msg.urls || [];
        urls.forEach((url) => {
            chrome.tabs.create({ url, active: false });
        });
        sendResponse({ success: true });
        return false;
    }

    if (msg.action === 'openProjectWindow') {
        openProjectWindow(msg.urls || [])
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ success: false, error: err.message }));
        return true; // async response
    }

    if (msg.action === 'switchToProject') {
        switchToProject(msg.urls || [])
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ success: false, error: err.message }));
        return true; // async response
    }
});

/**
 * Open project tabs in a brand new window, leaving the current window untouched.
 */
async function openProjectWindow(urls) {
    if (!urls.length) return;

    // Create a new window with the first URL
    const newWindow = await chrome.windows.create({ url: urls[0], focused: true });

    // Add remaining tabs to the new window
    for (let i = 1; i < urls.length; i++) {
        chrome.tabs.create({ url: urls[i], windowId: newWindow.id, active: false });
    }
}

/**
 * Close all non-pinned tabs in current window, then open project tabs.
 */
async function switchToProject(urls) {
    if (!urls.length) return;

    const currentWindow = await chrome.windows.getCurrent({ populate: true });
    const tabsToClose = currentWindow.tabs
        .filter((t) => !t.pinned)
        .map((t) => t.id);

    // Open new tabs first
    const firstTab = await chrome.tabs.create({ url: urls[0], active: true });
    for (let i = 1; i < urls.length; i++) {
        chrome.tabs.create({ url: urls[i], active: false });
    }

    // Then close old tabs
    if (tabsToClose.length > 0) {
        chrome.tabs.remove(tabsToClose);
    }
}
