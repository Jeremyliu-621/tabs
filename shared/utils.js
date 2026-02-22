import { IGNORED_URL_PREFIXES, TRACKING } from './constants.js';

/**
 * Extract the domain from a URL string.
 * Returns null for invalid or ignored URLs.
 */
export function extractDomain(url) {
    if (!url || shouldIgnoreUrl(url)) return null;
    try {
        const parsed = new URL(url);
        return parsed.hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}

/**
 * Check whether a URL should be ignored (chrome://, about:, etc.)
 */
export function shouldIgnoreUrl(url) {
    if (!url) return true;
    return IGNORED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Generate a short unique ID (collision-unlikely for local use).
 */
export function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Human-readable "time ago" string.
 */
export function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'just now';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;

    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
}

/**
 * Truncate a string to maxLen, appending "…" if truncated.
 */
export function truncate(str, maxLen = 40) {
    if (!str) return '';
    return str.length <= maxLen ? str : str.slice(0, maxLen - 1) + '…';
}

/**
 * Get a clean, readable title from a tab.
 * Falls back to domain if the title is empty.
 */
export function getTabDisplayName(tab) {
    if (tab.title && tab.title.trim()) return truncate(tab.title);
    return extractDomain(tab.url) || 'Untitled';
}

/**
 * Split a chronological event array into sessions separated by inactivity gaps.
 *
 * Each session object contains:
 *   - id:      `session_<start_timestamp>` (stable identifier for prompt/debug use)
 *   - start:   earliest event timestamp in the session
 *   - end:     latest event timestamp in the session
 *   - events:  array of the raw event objects in chronological order
 *   - domains: Set<string> of unique domains seen during the session
 *
 * @param {Array}  events     - Tab events; each must have `.domain` and `.timestamp`.
 * @param {number} sessionGap - Max inactivity (ms) before a new session starts.
 *                               Defaults to TRACKING.SESSION_GAP (15 min).
 * @returns {Array} Array of session objects, chronologically ordered.
 */
export function buildSessions(events, sessionGap = TRACKING.SESSION_GAP) {
    const sorted = [...events]
        .filter((e) => e.domain && e.timestamp)
        .sort((a, b) => a.timestamp - b.timestamp);

    if (sorted.length === 0) return [];

    const sessions = [];
    let current = {
        id: `session_${sorted[0].timestamp}`,
        start: sorted[0].timestamp,
        end: sorted[0].timestamp,
        events: [sorted[0]],
        domains: new Set([sorted[0].domain]),
    };

    for (let i = 1; i < sorted.length; i++) {
        const e = sorted[i];
        if (e.timestamp - current.end > sessionGap) {
            sessions.push(current);
            current = {
                id: `session_${e.timestamp}`,
                start: e.timestamp,
                end: e.timestamp,
                events: [e],
                domains: new Set([e.domain]),
            };
        } else {
            current.end = e.timestamp;
            current.events.push(e);
            current.domains.add(e.domain);
        }
    }
    sessions.push(current);

    return sessions;
}
