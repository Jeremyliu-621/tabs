/**
 * Tabs — Background Service Worker
 *
 * Entry point for the extension's background process.
 * Initializes passive tab tracking and periodic clustering.
 */

import { startTracking } from './tracker.js';
import { runClustering } from './clustering.js';

// ── Initialization ───────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[Tabs] Extension installed — tracking begins.');
    } else if (details.reason === 'update') {
        console.log(`[Tabs] Extension updated to v${chrome.runtime.getManifest().version}`);
    }

    // Run initial clustering after a short delay
    setTimeout(() => runClustering(), 3000);
});

// Start tracking immediately when the service worker spins up
startTracking();

// ── Periodic clustering ──────────────────────────────────────

// Run clustering every 30 seconds to keep projects continuously updated
const CLUSTER_INTERVAL = 30 * 1000;
let clusterTimer = null;

function startClusterLoop() {
    if (clusterTimer) clearInterval(clusterTimer);
    clusterTimer = setInterval(async () => {
        await runClustering();
    }, CLUSTER_INTERVAL);
}

startClusterLoop();

// ── Message handling (popup → background) ────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'runClustering') {
        runClustering()
            .then((projects) => sendResponse({ success: true, projects }))
            .catch((err) => sendResponse({ success: false, error: err.message }));
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
