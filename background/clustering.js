import { generateId, buildSessions } from '../shared/utils.js';
import { calculateJaccardSimilarity } from '../shared/project-utils.js';
import {
    getTabEvents,
    getProjects,
    saveProjects,
    getUserBlacklist,
    getClusteringSettings,
} from './storage.js';

/**
 * Session-based clustering engine for automatic project detection.
 *
 * Algorithm overview:
 * 1. Filter events to the recent data-retention window (default 7 days)
 * 2. Split events into sessions based on inactivity gap (default 15 min)
 * 3. Each multi-domain session becomes a project candidate
 * 4. Deduplicate candidates against existing projects (≥80% Jaccard overlap → merge)
 * 5. Mark stale projects as archived (not accessed within archive threshold)
 * 6. Apply user's domain blacklist
 * 7. Preserve user-created projects, starred status, and custom names
 * 8. Sort, cap, and save
 *
 * Key difference from previous approach:
 * - Domains CAN appear in multiple projects (no enforceNonOverlap)
 * - Sessions are the atomic unit, not a global co-occurrence matrix
 */

// ── Main entry point ─────────────────────────────────────────

/**
 * Run the full clustering pipeline and save detected projects.
 * Preserves manually-created or user-edited projects.
 */
export async function runClustering() {
    const settings = await getClusteringSettings();

    // Step 1: Get recent events only
    const allEvents = await getTabEvents();
    const recentEvents = filterRecentEvents(allEvents, settings.dataRetention);
    if (recentEvents.length < 3) return [];

    // Step 2: Build sessions
    const sessions = buildSessions(recentEvents, settings.sessionGap);
    if (sessions.length === 0) return [];

    // Step 3: Create project candidates from multi-domain sessions
    const candidates = sessions
        .filter((s) => s.domains.size >= settings.minClusterSize)
        .map((s) => sessionToProject(s));

    // Step 4: Load existing projects and separate manual from auto-detected
    const existingProjects = await getProjects();
    const manualProjects = existingProjects.filter((p) => !p.autoDetected);
    const prevAutoDetected = existingProjects.filter((p) => p.autoDetected && !p.dismissed);
    const dismissedProjects = existingProjects.filter((p) => p.autoDetected && p.dismissed);

    // Step 5: Deduplicate candidates against existing AND dismissed projects
    // Dismissed projects participate in dedup so candidates don't get recreated
    const deduplicated = deduplicateProjects(
        [...prevAutoDetected, ...dismissedProjects],
        candidates,
        settings.overlapThreshold
    );

    // Strip dismissed projects back out — they only existed to block recreation
    const withoutDismissed = deduplicated.filter((p) => !p.dismissed);

    // Step 6: Mark archived projects
    const withArchiveStatus = markArchivedProjects(
        withoutDismissed,
        settings.archiveThreshold
    );

    // Step 7: Apply domain blacklist
    const blacklist = await getUserBlacklist();
    const filtered = applyBlacklist(withArchiveStatus, blacklist);

    // Step 8: Restore user customizations (starred, renamed)
    const restored = restoreUserCustomizations(filtered, prevAutoDetected);

    // Step 9: Sort and cap
    const sorted = sortProjects(restored);
    const activeCount = sorted.filter((p) => !p.archived).length;
    const capped = capActiveProjects(sorted, settings.maxAutoProjects);

    // Step 10: Combine with manual projects and dismissed (to persist blocking), then save
    const final = [...manualProjects, ...capped.map(cleanForStorage), ...dismissedProjects];
    await saveProjects(final);

    console.log(
        `[Tabs] Clustering complete: ${final.length} projects ` +
        `(${Math.min(activeCount, settings.maxAutoProjects)} active auto-detected)`
    );

    return final;
}

// ── Step 1: Filter recent events ─────────────────────────────

export function filterRecentEvents(events, retentionMs) {
    const cutoff = Date.now() - retentionMs;
    return events.filter((e) => e.timestamp >= cutoff);
}

// ── Step 2: Session detection ── (see shared/utils.js buildSessions)

// ── Step 3: Convert session → project candidate ──────────────

export function sessionToProject(session) {
    const domains = [...session.domains];
    const domainUrls = {};

    // Collect unique URLs per domain from the session
    for (const e of session.events) {
        if (!e.url || !e.title || !e.domain) continue;
        if (!domainUrls[e.domain]) domainUrls[e.domain] = [];
        const existing = domainUrls[e.domain].find((x) => x.url === e.url);
        if (!existing) {
            domainUrls[e.domain].push({ url: e.url, title: e.title });
        } else {
            // Update title to the latest one
            existing.title = e.title;
        }
    }

    // Build branches (one per domain)
    const branches = domains.map((domain) => {
        const urls = (domainUrls[domain] || []).slice(0, 10);
        return {
            id: generateId(),
            domain,
            tabs: urls.map((u) => ({ url: u.url, title: u.title })),
        };
    });

    // Sort branches by number of tabs (most active domain first)
    branches.sort((a, b) => b.tabs.length - a.tabs.length);

    const primaryDomain = branches[0]?.domain || domains[0];

    return {
        id: generateId(),
        name: primaryDomain,
        autoDetected: true,
        starred: false,
        archived: false,
        lastAccessed: session.end,
        createdAt: session.start,
        branches,
        // Keep domain set for overlap calculation (stripped before saving)
        _domains: new Set(domains),
    };
}

// ── Step 5: Deduplicate projects ─────────────────────────────

/**
 * Merge new session candidates into existing projects when domain
 * overlap exceeds the threshold. Domains CAN appear in multiple projects.
 */
export function deduplicateProjects(existing, newCandidates, overlapThreshold) {
    // Deep clone existing to avoid mutating the originals
    const result = existing.map((p) => ({
        ...p,
        branches: (p.branches || []).map((b) => ({
            ...b,
            tabs: [...(b.tabs || [])],
        })),
        _domains: new Set(
            p.branches ? p.branches.map((b) => b.domain) : []
        ),
    }));

    for (const candidate of newCandidates) {
        let merged = false;

        for (const existingProj of result) {
            const overlap = calculateJaccardSimilarity(
                candidate._domains,
                existingProj._domains
            );

            if (overlap >= overlapThreshold) {
                // Merge: add new tabs/branches, update timestamps
                mergeBranches(existingProj, candidate);

                existingProj.lastAccessed = Math.max(
                    existingProj.lastAccessed || 0,
                    candidate.lastAccessed
                );

                // Expand the domain set
                for (const d of candidate._domains) {
                    existingProj._domains.add(d);
                }

                merged = true;
                break;
            }
        }

        if (!merged) {
            result.push(candidate);
        }
    }

    return result;
}

/**
 * Merge branches from a candidate into an existing project.
 * For matching domains, add new tabs (deduped by URL).
 * For new domains, add the entire branch.
 */
export function mergeBranches(target, source) {
    for (const newBranch of source.branches) {
        const existingBranch = target.branches.find(
            (b) => b.domain === newBranch.domain
        );

        if (existingBranch) {
            // Add new tabs, deduped by URL
            for (const tab of newBranch.tabs) {
                if (!existingBranch.tabs.some((t) => t.url === tab.url)) {
                    existingBranch.tabs.push(tab);
                }
            }
            // Cap tabs per branch to prevent unbounded growth
            if (existingBranch.tabs.length > 15) {
                existingBranch.tabs = existingBranch.tabs.slice(-15);
            }
        } else {
            target.branches.push(newBranch);
        }
    }
}

// ── Step 5b: Jaccard similarity is in shared/project-utils.js

// ── Step 6: Archive old projects ─────────────────────────────

export function markArchivedProjects(projects, archiveThreshold) {
    const now = Date.now();

    return projects.map((p) => ({
        ...p,
        archived: now - (p.lastAccessed || 0) > archiveThreshold,
    }));
}

// ── Step 7: Apply domain blacklist ───────────────────────────

export function applyBlacklist(projects, blacklist) {
    if (!blacklist || blacklist.length === 0) return projects;

    return projects.map((p) => {
        const filteredBranches = p.branches.filter(
            (b) => !blacklist.includes(b.domain)
        );

        if (filteredBranches.length === 0) {
            // All branches removed → archive the project
            return { ...p, branches: filteredBranches, archived: true };
        }

        return { ...p, branches: filteredBranches };
    });
}

// ── Step 8: Restore user customizations ──────────────────────

/**
 * Carry over starred status and custom names from previous
 * auto-detected projects to the newly generated ones.
 */
export function restoreUserCustomizations(newProjects, prevAutoDetected) {
    // Build lookup maps from previous auto-detected projects
    const starredDomainSets = [];
    const renamedMap = new Map(); // primary domain → custom name

    for (const p of prevAutoDetected) {
        const primaryDomain = p.branches?.[0]?.domain;

        if (p.starred) {
            starredDomainSets.push({
                domains: new Set(p.branches.map((b) => b.domain)),
                name: p.name,
            });
        }

        if (primaryDomain && p.name !== primaryDomain) {
            renamedMap.set(primaryDomain, p.name);
        }
    }

    return newProjects.map((proj) => {
        const projDomains = proj._domains || new Set(proj.branches.map((b) => b.domain));
        const primaryDomain = proj.branches?.[0]?.domain;

        // Check if this project matches a previously starred one
        for (const starred of starredDomainSets) {
            const overlap = calculateJaccardSimilarity(projDomains, starred.domains);
            if (overlap >= 0.8) {
                proj.starred = true;
                // Also restore the name if it was customized
                if (starred.name !== starred.domains.values().next().value) {
                    proj.name = starred.name;
                }
                break;
            }
        }

        // Restore custom name by primary domain
        if (primaryDomain && renamedMap.has(primaryDomain) && !proj.starred) {
            proj.name = renamedMap.get(primaryDomain);
        }

        return proj;
    });
}

// ── Step 9: Sort and cap ─────────────────────────────────────

export function sortProjects(projects) {
    return [...projects].sort((a, b) => {
        // Starred first
        if (a.starred && !b.starred) return -1;
        if (!a.starred && b.starred) return 1;
        // Active before archived
        if (a.archived !== b.archived) return a.archived ? 1 : -1;
        // Then by lastAccessed descending
        return (b.lastAccessed || 0) - (a.lastAccessed || 0);
    });
}

/**
 * Cap the number of active auto-detected projects.
 * Archived projects are always kept (they're hidden in the UI).
 */
export function capActiveProjects(projects, maxActive) {
    const result = [];
    let activeCount = 0;

    for (const p of projects) {
        if (!p.archived) {
            if (activeCount < maxActive) {
                result.push(p);
                activeCount++;
            }
            // Skip excess active projects entirely
        } else {
            result.push(p);
        }
    }

    return result;
}

// ── Clean project for storage ────────────────────────────────

/**
 * Strip internal fields (like _domains Set) before saving.
 * Called implicitly via saveProjects since Sets don't serialize.
 * But we explicitly clean to be safe.
 */
export function cleanForStorage(project) {
    const { _domains, ...clean } = project;
    return clean;
}
