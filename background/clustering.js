import { TRACKING } from '../shared/constants.js';
import { generateId } from '../shared/utils.js';
import { getTabEvents, getProjects, saveProjects } from './storage.js';

/**
 * Clustering engine for automatic project detection.
 *
 * Algorithm overview:
 * 1. Split raw events into browsing sessions (30-min gap)
 * 2. Within each session, group events by domain → "branches"
 * 3. Build a co-occurrence matrix: how often domains appear in the same session
 * 4. Cluster high-affinity domains into projects using greedy agglomeration
 * 5. Promote high-activity standalone domains as their own projects
 * 6. Enforce non-overlap: each domain belongs to exactly one project
 * 7. Merge new clusters with existing projects (don't destroy user edits)
 */

// ── Tuning constants ─────────────────────────────────────────

/** Minimum raw events before we attempt clustering at all */
const MIN_EVENTS = 3;

/** Minimum co-occurrence score to merge two clusters */
const MIN_AFFINITY = 1;

/** Minimum sessions a domain must appear in to be considered */
const MIN_DOMAIN_SESSIONS = 1;

/** Standalone domains with this many events become their own project */
const STANDALONE_MIN_EVENTS = 4;

/** Maximum number of auto-detected projects to keep (prevents clutter) */
const MAX_AUTO_PROJECTS = 10;

// ── Main entry point ─────────────────────────────────────────

/**
 * Run the full clustering pipeline and save detected projects.
 * Preserves manually-created or user-edited projects.
 */
export async function runClustering() {
    const events = await getTabEvents();
    if (events.length < MIN_EVENTS) return;

    const existingProjects = await getProjects();

    // Step 1: Build sessions
    const sessions = buildSessions(events);
    if (sessions.length === 0) return;

    // Step 2: Build domain stats
    const domainStats = buildDomainStats(events, sessions);

    // Step 3: Build co-occurrence matrix
    const coMatrix = buildCoOccurrenceMatrix(sessions);

    // Step 4: Cluster domains into groups
    const clusters = clusterDomains(coMatrix, sessions, domainStats);

    // Step 5: Enforce non-overlap — each domain in exactly one cluster
    const cleanClusters = enforceNonOverlap(clusters, domainStats);

    // Step 6: Promote active standalone domains not yet in any cluster
    const allClustered = new Set(cleanClusters.flat());
    const standalones = findStandaloneDomains(domainStats, allClustered);
    const allClusters = [...cleanClusters, ...standalones];

    if (allClusters.length === 0) return;

    // Step 7: Convert clusters to project objects
    const detectedProjects = allClusters.map((cluster) =>
        clusterToProject(cluster, sessions, events)
    );

    // Step 8: Cap at MAX_AUTO_PROJECTS
    const capped = detectedProjects
        .sort((a, b) => b.lastAccessed - a.lastAccessed)
        .slice(0, MAX_AUTO_PROJECTS);

    // Step 9: Merge with existing projects
    const merged = mergeProjects(existingProjects, capped);

    await saveProjects(merged);
    console.log(`[Tabs] Clustering complete: ${merged.length} projects (${capped.length} auto-detected)`);

    return merged;
}

// ── Step 1: Session detection ────────────────────────────────

function buildSessions(events) {
    const sorted = [...events]
        .filter((e) => e.domain && e.timestamp)
        .sort((a, b) => a.timestamp - b.timestamp);

    if (sorted.length === 0) return [];

    const sessions = [];
    let current = {
        start: sorted[0].timestamp,
        end: sorted[0].timestamp,
        events: [sorted[0]],
        domains: new Set([sorted[0].domain]),
    };

    for (let i = 1; i < sorted.length; i++) {
        const e = sorted[i];
        if (e.timestamp - current.end > TRACKING.SESSION_GAP) {
            sessions.push(current);
            current = {
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

// ── Step 2: Domain stats ─────────────────────────────────────

function buildDomainStats(events, sessions) {
    const stats = {};

    for (const e of events) {
        if (!e.domain) continue;
        if (!stats[e.domain]) {
            stats[e.domain] = { eventCount: 0, sessionCount: 0, lastSeen: 0 };
        }
        stats[e.domain].eventCount++;
        if (e.timestamp > stats[e.domain].lastSeen) {
            stats[e.domain].lastSeen = e.timestamp;
        }
    }

    for (const session of sessions) {
        for (const d of session.domains) {
            if (stats[d]) stats[d].sessionCount++;
        }
    }

    return stats;
}

// ── Step 3: Co-occurrence matrix ─────────────────────────────

function buildCoOccurrenceMatrix(sessions) {
    const matrix = new Map();

    for (const session of sessions) {
        const domains = [...session.domains];
        for (let i = 0; i < domains.length; i++) {
            for (let j = i + 1; j < domains.length; j++) {
                const key = pairKey(domains[i], domains[j]);
                matrix.set(key, (matrix.get(key) || 0) + 1);
            }
        }
    }

    return matrix;
}

// ── Step 4: Greedy agglomerative clustering ──────────────────

function clusterDomains(coMatrix, sessions, domainStats) {
    // Only consider domains meeting the minimum session threshold
    const activeDomains = Object.keys(domainStats).filter(
        (d) => domainStats[d].sessionCount >= MIN_DOMAIN_SESSIONS
    );

    if (activeDomains.length < 2) return [];

    // Initialize: each domain = one cluster
    let clusters = activeDomains.map((d) => new Set([d]));

    // Greedy merge loop
    const MAX_ITERATIONS = 50;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        let bestScore = 0;
        let bestI = -1;
        let bestJ = -1;

        for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const score = clusterAffinity(clusters[i], clusters[j], coMatrix);
                if (score > bestScore) {
                    bestScore = score;
                    bestI = i;
                    bestJ = j;
                }
            }
        }

        if (bestScore < MIN_AFFINITY) break;

        // Don't let clusters grow too large (keeps projects focused)
        if (clusters[bestI].size + clusters[bestJ].size > 8) break;

        // Merge bestJ into bestI
        for (const d of clusters[bestJ]) {
            clusters[bestI].add(d);
        }
        clusters.splice(bestJ, 1);
    }

    // Keep clusters with 2+ domains
    return clusters.filter((c) => c.size >= 2).map((c) => [...c]);
}

function clusterAffinity(clusterA, clusterB, coMatrix) {
    let totalScore = 0;
    let pairCount = 0;

    for (const a of clusterA) {
        for (const b of clusterB) {
            totalScore += coMatrix.get(pairKey(a, b)) || 0;
            pairCount++;
        }
    }

    return pairCount > 0 ? totalScore / pairCount : 0;
}

// ── Step 5: Non-overlap enforcement ──────────────────────────

/**
 * If a domain ended up in multiple clusters (shouldn't happen with
 * agglomerative, but safety net), assign it to the cluster where
 * it has the strongest affinity.
 */
function enforceNonOverlap(clusters, domainStats) {
    const domainAssignment = new Map(); // domain → cluster index

    for (let i = 0; i < clusters.length; i++) {
        for (const domain of clusters[i]) {
            if (!domainAssignment.has(domain)) {
                domainAssignment.set(domain, i);
            } else {
                // Already assigned — keep in the cluster with more activity
                const existingIdx = domainAssignment.get(domain);
                const existingSize = clusters[existingIdx].length;
                const currentSize = clusters[i].length;
                // Prefer the larger cluster
                if (currentSize > existingSize) {
                    // Remove from old cluster
                    clusters[existingIdx] = clusters[existingIdx].filter((d) => d !== domain);
                    domainAssignment.set(domain, i);
                } else {
                    // Remove from current cluster
                    clusters[i] = clusters[i].filter((d) => d !== domain);
                }
            }
        }
    }

    // Filter out any clusters that became empty or single-domain after cleanup
    return clusters.filter((c) => c.length >= 2);
}

// ── Step 6: Standalone domain promotion ──────────────────────

/**
 * Domains with significant activity that aren't part of any cluster
 * get promoted to their own single-domain project.
 */
function findStandaloneDomains(domainStats, clusteredDomains) {
    const standalones = [];

    for (const [domain, stats] of Object.entries(domainStats)) {
        if (clusteredDomains.has(domain)) continue;
        if (stats.eventCount >= STANDALONE_MIN_EVENTS) {
            standalones.push([domain]);
        }
    }

    return standalones;
}

// ── Step 7: Convert cluster → project ────────────────────────

function clusterToProject(clusterDomains, sessions, events) {
    let lastAccessed = 0;
    const domainUrls = {};

    for (const e of events) {
        if (!clusterDomains.includes(e.domain)) continue;
        if (e.timestamp > lastAccessed) lastAccessed = e.timestamp;

        if (e.url && e.title) {
            if (!domainUrls[e.domain]) domainUrls[e.domain] = [];
            const existing = domainUrls[e.domain].find((x) => x.url === e.url);
            if (!existing) {
                domainUrls[e.domain].push({ url: e.url, title: e.title });
            } else {
                existing.title = e.title;
            }
        }
    }

    // Build branches (one per domain)
    const branches = clusterDomains.map((domain) => {
        const urls = (domainUrls[domain] || []).slice(0, 10);
        return {
            id: generateId(),
            domain,
            tabs: urls.map((u) => ({
                url: u.url,
                title: u.title,
            })),
        };
    });

    branches.sort((a, b) => b.tabs.length - a.tabs.length);

    const primaryDomain = branches[0]?.domain || clusterDomains[0];

    return {
        id: generateId(),
        name: primaryDomain,
        autoDetected: true,
        starred: false,
        lastAccessed,
        branches,
        createdAt: Date.now(),
    };
}

// ── Step 8: Merge with existing ──────────────────────────────

function mergeProjects(existing, detected) {
    const manual = existing.filter((p) => !p.autoDetected);

    // Preserve starred status and custom names from previous auto-detected projects
    const prevAutoDetected = existing.filter((p) => p.autoDetected);
    const starredNames = new Set(
        prevAutoDetected.filter((p) => p.starred).map((p) => p.name)
    );
    const renamedMap = new Map();
    for (const p of prevAutoDetected) {
        // If user renamed a project (name differs from primary domain), preserve it
        if (p.branches && p.branches.length > 0) {
            const primaryDomain = p.branches[0]?.domain;
            if (primaryDomain && p.name !== primaryDomain) {
                renamedMap.set(primaryDomain, p.name);
            }
        }
    }

    for (const dp of detected) {
        // Restore starred status
        if (starredNames.has(dp.name)) {
            dp.starred = true;
        }
        // Restore custom name
        if (dp.branches && dp.branches.length > 0) {
            const primaryDomain = dp.branches[0]?.domain;
            if (primaryDomain && renamedMap.has(primaryDomain)) {
                dp.name = renamedMap.get(primaryDomain);
                if (starredNames.has(dp.name)) dp.starred = true;
            }
        }
    }

    // Sort: starred first, then by lastAccessed desc
    const sortedAuto = [...detected].sort((a, b) => {
        if (a.starred && !b.starred) return -1;
        if (!a.starred && b.starred) return 1;
        return b.lastAccessed - a.lastAccessed;
    });

    return [...manual, ...sortedAuto];
}

// ── Helpers ──────────────────────────────────────────────────

function pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}
