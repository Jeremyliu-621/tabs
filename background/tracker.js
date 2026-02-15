import { EVENT_TYPES, TRACKING } from '../shared/constants.js';
import { extractDomain, shouldIgnoreUrl, generateId } from '../shared/utils.js';
import { addTabEvent } from './storage.js';

/**
 * Passive tab tracker.
 * Listens to Chrome tab events and persists them to local storage.
 */

// ── State ────────────────────────────────────────────────────

/** Currently focused tab info, used to compute focus duration. */
let activeFocus = {
    tabId: null,
    url: null,
    startTime: null,
};

/** Debounce timer for onUpdated (fires many times per navigation). */
let updateDebounceTimers = new Map();

// ── Public API ───────────────────────────────────────────────

/**
 * Start listening to all tab events.
 * Call once from the service worker.
 */
export function startTracking() {
    chrome.tabs.onCreated.addListener(handleCreated);
    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.onRemoved.addListener(handleRemoved);

    // Seed the initial active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            activeFocus.tabId = tabs[0].id;
            activeFocus.url = tabs[0].url;
            activeFocus.startTime = Date.now();
        }
    });

    console.log('[Tabs] Tracker started');
}

// ── Event handlers ───────────────────────────────────────────

function handleCreated(tab) {
    // New tabs often have no URL yet — we'll catch it in onUpdated
    if (!tab.url || shouldIgnoreUrl(tab.url)) return;

    recordEvent(EVENT_TYPES.CREATED, {
        tabId: tab.id,
        url: tab.url,
        title: tab.title || '',
        domain: extractDomain(tab.url),
    });
}

function handleActivated(activeInfo) {
    // Flush focus duration for the previously active tab
    flushFocusDuration();

    // Look up the new active tab to get its URL
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        if (shouldIgnoreUrl(tab.url)) return;

        activeFocus.tabId = tab.id;
        activeFocus.url = tab.url;
        activeFocus.startTime = Date.now();

        recordEvent(EVENT_TYPES.ACTIVATED, {
            tabId: tab.id,
            url: tab.url,
            title: tab.title || '',
            domain: extractDomain(tab.url),
        });
    });
}

function handleUpdated(tabId, changeInfo, tab) {
    // Only care about completed navigations with a real URL
    if (changeInfo.status !== 'complete') return;
    if (!tab.url || shouldIgnoreUrl(tab.url)) return;

    // Debounce — onUpdated can fire rapidly for the same tab
    if (updateDebounceTimers.has(tabId)) {
        clearTimeout(updateDebounceTimers.get(tabId));
    }

    updateDebounceTimers.set(
        tabId,
        setTimeout(() => {
            updateDebounceTimers.delete(tabId);

            recordEvent(EVENT_TYPES.UPDATED, {
                tabId,
                url: tab.url,
                title: tab.title || '',
                domain: extractDomain(tab.url),
            });

            // If this is the active tab, reset focus tracking for new URL
            if (activeFocus.tabId === tabId) {
                flushFocusDuration();
                activeFocus.url = tab.url;
                activeFocus.startTime = Date.now();
            }
        }, TRACKING.DEBOUNCE_DELAY)
    );
}

function handleRemoved(tabId) {
    // If the removed tab was the focused one, flush its duration
    if (activeFocus.tabId === tabId) {
        flushFocusDuration();
        activeFocus.tabId = null;
        activeFocus.url = null;
        activeFocus.startTime = null;
    }

    recordEvent(EVENT_TYPES.REMOVED, { tabId });
}

// ── Helpers ──────────────────────────────────────────────────

function flushFocusDuration() {
    if (!activeFocus.tabId || !activeFocus.startTime) return;

    const duration = Date.now() - activeFocus.startTime;

    if (duration >= TRACKING.MIN_FOCUS_DURATION && activeFocus.url) {
        recordEvent('focus_end', {
            tabId: activeFocus.tabId,
            url: activeFocus.url,
            domain: extractDomain(activeFocus.url),
            focusDuration: duration,
        });
    }
}

function recordEvent(type, data = {}) {
    const event = {
        id: generateId(),
        type,
        timestamp: Date.now(),
        ...data,
    };

    addTabEvent(event).catch((err) =>
        console.error('[Tabs] Failed to record event:', err)
    );
}
