import { IGNORED_URL_PREFIXES } from './constants.js';

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
