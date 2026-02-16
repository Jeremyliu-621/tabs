import { STORAGE_KEYS, RETENTION, TRACKING, CLUSTERING, AI } from '../shared/constants.js';

/**
 * Thin wrapper around chrome.storage.local.
 * All methods return Promises.
 */

// ── Generic helpers ──────────────────────────────────────────

export async function get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
}

export async function set(key, value) {
    return chrome.storage.local.set({ [key]: value });
}

export async function remove(key) {
    return chrome.storage.local.remove(key);
}

// ── Tab Events ───────────────────────────────────────────────

/**
 * Append a tab event to storage.
 * Automatically prunes old events if the list exceeds MAX_EVENTS.
 */
export async function addTabEvent(event) {
    const events = (await get(STORAGE_KEYS.TAB_EVENTS)) || [];
    events.push(event);

    // Prune if over limit
    if (events.length > RETENTION.MAX_EVENTS) {
        const cutoff = Date.now() - RETENTION.MAX_EVENT_AGE;
        const pruned = events.filter((e) => e.timestamp >= cutoff);
        // If still over limit after age pruning, keep only the newest
        const final =
            pruned.length > RETENTION.MAX_EVENTS
                ? pruned.slice(pruned.length - RETENTION.MAX_EVENTS)
                : pruned;
        await set(STORAGE_KEYS.TAB_EVENTS, final);
        return;
    }

    await set(STORAGE_KEYS.TAB_EVENTS, events);
}

/**
 * Get all stored tab events.
 */
export async function getTabEvents() {
    return (await get(STORAGE_KEYS.TAB_EVENTS)) || [];
}

/**
 * Clear all tab events.
 */
export async function clearTabEvents() {
    return set(STORAGE_KEYS.TAB_EVENTS, []);
}

// ── Projects ─────────────────────────────────────────────────

export async function getProjects() {
    return (await get(STORAGE_KEYS.PROJECTS)) || [];
}

export async function saveProjects(projects) {
    return set(STORAGE_KEYS.PROJECTS, projects);
}

/**
 * Get only active (non-archived) projects.
 */
export async function getActiveProjects() {
    const all = await getProjects();
    return all.filter((p) => !p.archived);
}

/**
 * Get only archived projects.
 */
export async function getArchivedProjects() {
    const all = await getProjects();
    return all.filter((p) => p.archived);
}

// ── Domain Blacklist ─────────────────────────────────────────

/**
 * Get the list of user-blacklisted domains.
 */
export async function getUserBlacklist() {
    return (await get(STORAGE_KEYS.BLACKLIST)) || [];
}

/**
 * Save the domain blacklist.
 */
export async function saveUserBlacklist(domains) {
    return set(STORAGE_KEYS.BLACKLIST, domains);
}

// ── Clustering Settings (user-editable) ──────────────────────

/**
 * Get user-customized clustering settings, merged with defaults.
 * Returns an object with keys: sessionGap, dataRetention,
 * archiveThreshold, overlapThreshold, minClusterSize, maxAutoProjects.
 */
export async function getClusteringSettings() {
    const saved = (await get(STORAGE_KEYS.CLUSTERING_SETTINGS)) || {};
    return {
        sessionGap: saved.sessionGap ?? TRACKING.SESSION_GAP,
        dataRetention: saved.dataRetention ?? CLUSTERING.DATA_RETENTION,
        archiveThreshold: saved.archiveThreshold ?? CLUSTERING.ARCHIVE_THRESHOLD,
        overlapThreshold: saved.overlapThreshold ?? CLUSTERING.OVERLAP_THRESHOLD,
        minClusterSize: saved.minClusterSize ?? CLUSTERING.MIN_CLUSTER_SIZE,
        maxAutoProjects: saved.maxAutoProjects ?? CLUSTERING.MAX_AUTO_PROJECTS,
    };
}

/**
 * Save user-customized clustering settings (partial updates OK).
 */
export async function saveClusteringSettings(settings) {
    const current = await getClusteringSettings();
    return set(STORAGE_KEYS.CLUSTERING_SETTINGS, { ...current, ...settings });
}

// ── Stats (quick counts for the popup stub) ──────────────────

/**
 * Return a lightweight summary for the popup.
 */
export async function getStats() {
    const events = await getTabEvents();
    const projects = await getProjects();

    const uniqueDomains = new Set();
    for (const e of events) {
        if (e.domain) uniqueDomains.add(e.domain);
    }

    return {
        totalEvents: events.length,
        uniqueDomains: uniqueDomains.size,
        projectCount: projects.length,
    };
}

// ── Debug Analytics ──────────────────────────────────────────

/**
 * Compute detailed analytics for the debug popup view.
 * Returns domain frequencies, co-occurrence pairs, recent events, and sessions.
 */
export async function getDebugAnalytics() {
    const events = await getTabEvents();

    // 1. Domain frequency (sorted desc)
    const domainCounts = {};
    const domainTitles = {}; // track example titles per domain
    for (const e of events) {
        if (!e.domain) continue;
        domainCounts[e.domain] = (domainCounts[e.domain] || 0) + 1;
        if (e.title && !domainTitles[e.domain]) {
            domainTitles[e.domain] = e.title;
        }
    }
    const domainFrequency = Object.entries(domainCounts)
        .map(([domain, count]) => ({ domain, count, exampleTitle: domainTitles[domain] || '' }))
        .sort((a, b) => b.count - a.count);

    // 2. Co-occurrence: domains that appear together within CLUSTER_WINDOW
    const CLUSTER_WINDOW = 5 * 60 * 1000; // 5 minutes
    const coOccurrence = {};
    const domainEvents = events
        .filter((e) => e.domain && (e.type === 'created' || e.type === 'activated' || e.type === 'updated'))
        .sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < domainEvents.length; i++) {
        for (let j = i + 1; j < domainEvents.length; j++) {
            if (domainEvents[j].timestamp - domainEvents[i].timestamp > CLUSTER_WINDOW) break;
            const a = domainEvents[i].domain;
            const b = domainEvents[j].domain;
            if (a === b) continue;
            const key = [a, b].sort().join(' ↔ ');
            coOccurrence[key] = (coOccurrence[key] || 0) + 1;
        }
    }
    const coOccurrencePairs = Object.entries(coOccurrence)
        .map(([pair, strength]) => ({ pair, strength }))
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 15);

    // 3. Recent events (last 30)
    const recentEvents = events
        .slice(-30)
        .reverse()
        .map((e) => ({
            type: e.type,
            domain: e.domain || '—',
            title: e.title || '',
            url: e.url || '',
            timestamp: e.timestamp,
            focusDuration: e.focusDuration || null,
        }));

    // 4. Session detection (gaps > SESSION_GAP = new session)
    const SESSION_GAP = TRACKING.SESSION_GAP;
    const sessions = [];
    let currentSession = null;
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

    for (const e of sortedEvents) {
        if (!e.domain) continue;
        if (!currentSession || e.timestamp - currentSession.end > SESSION_GAP) {
            if (currentSession) sessions.push(currentSession);
            currentSession = {
                start: e.timestamp,
                end: e.timestamp,
                domains: new Set([e.domain]),
            };
        } else {
            currentSession.end = e.timestamp;
            currentSession.domains.add(e.domain);
        }
    }
    if (currentSession) sessions.push(currentSession);

    const sessionSummaries = sessions
        .slice(-10)
        .reverse()
        .map((s) => ({
            start: s.start,
            end: s.end,
            durationMin: Math.round((s.end - s.start) / 60000),
            domains: [...s.domains],
        }));

    return {
        domainFrequency: domainFrequency.slice(0, 20),
        coOccurrencePairs,
        recentEvents,
        sessions: sessionSummaries,
    };
}

// ── AI Cache ─────────────────────────────────────────────────

/**
 * Get the cached AI refinement result.
 * Returns { fingerprint, projects, timestamp } or null.
 */
export async function getAICache() {
    return (await get(STORAGE_KEYS.AI_CACHE)) || null;
}

/**
 * Save an AI refinement result to cache.
 */
export async function saveAICache(cache) {
    return set(STORAGE_KEYS.AI_CACHE, cache);
}

// ── AI Settings ──────────────────────────────────────────────

/**
 * Get AI settings (currently just { enabled }).
 */
export async function getAISettings() {
    const saved = (await get(STORAGE_KEYS.AI_SETTINGS)) || {};
    return {
        enabled: saved.enabled !== false, // default: enabled
    };
}

/**
 * Save AI settings.
 */
export async function saveAISettings(settings) {
    const current = await getAISettings();
    return set(STORAGE_KEYS.AI_SETTINGS, { ...current, ...settings });
}
