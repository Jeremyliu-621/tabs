/**
 * Pure utility functions for project comparison, merging, and similarity.
 *
 * Extracted from ai-clustering.js and clustering.js so they can be
 * imported without Chrome API side-effects (→ testable with Node).
 */

// ── Project change detection ─────────────────────────────────

/**
 * Check if there are meaningful changes between existing and new projects.
 * Ignores timestamp-only updates.
 */
export function hasProjectChanges(existingProjects, newProjects) {
    // Quick check: different counts mean changes
    if (existingProjects.length !== newProjects.length) {
        return true;
    }
    
    // Build maps for comparison
    const existingMap = new Map(existingProjects.map(p => [p.id, p]));
    const newMap = new Map(newProjects.map(p => [p.id, p]));
    
    // Check if any project IDs changed (new/removed projects)
    const existingIds = new Set(existingProjects.map(p => p.id));
    const newIds = new Set(newProjects.map(p => p.id));
    
    if (existingIds.size !== newIds.size) {
        return true;
    }
    
    for (const id of existingIds) {
        if (!newIds.has(id)) {
            return true; // Project removed
        }
    }
    
    for (const id of newIds) {
        if (!existingIds.has(id)) {
            return true; // New project added
        }
    }
    
    // Compare project content (excluding timestamps)
    for (const [id, newProject] of newMap) {
        const existing = existingMap.get(id);
        if (!existing) continue;
        
        // Compare meaningful properties
        if (existing.name !== newProject.name) return true;
        if (existing.starred !== newProject.starred) return true;
        if (existing.archived !== newProject.archived) return true;
        if (existing.pinned !== newProject.pinned) return true;
        
        // Compare branches structure
        const existingBranches = existing.branches || [];
        const newBranches = newProject.branches || [];
        
        if (existingBranches.length !== newBranches.length) return true;
        
        // Compare branch domains and tab counts
        const existingBranchInfo = existingBranches.map(b => `${b.domain}:${b.tabs?.length || 0}`).sort().join('|');
        const newBranchInfo = newBranches.map(b => `${b.domain}:${b.tabs?.length || 0}`).sort().join('|');
        
        if (existingBranchInfo !== newBranchInfo) return true;
    }
    
    // No meaningful changes detected
    return false;
}

// ── Name normalization & similarity ──────────────────────────

/**
 * Normalize project name for fuzzy matching.
 * Removes common variations, extra spaces, and special characters.
 */
export function normalizeProjectName(name) {
    if (!name) return '';
    return name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/[^\w\s-]/g, '') // Remove special chars except hyphens
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Calculate fuzzy name similarity (0-1).
 * Returns 1 for exact match, high score for similar names.
 */
export function nameSimilarity(name1, name2) {
    const n1 = normalizeProjectName(name1);
    const n2 = normalizeProjectName(name2);
    
    if (n1 === n2) return 1.0;
    
    // Check if one contains the other
    if (n1.includes(n2) || n2.includes(n1)) {
        const shorter = Math.min(n1.length, n2.length);
        const longer = Math.max(n1.length, n2.length);
        return shorter / longer; // Partial match score
    }
    
    // Simple word overlap
    const words1 = new Set(n1.split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(n2.split(/\s+/).filter(w => w.length > 2));
    if (words1.size === 0 || words2.size === 0) return 0;
    
    let overlap = 0;
    for (const word of words1) {
        if (words2.has(word)) overlap++;
    }
    
    return overlap / Math.max(words1.size, words2.size);
}

// ── Domain / URL helpers ─────────────────────────────────────

/**
 * Get primary domain from project (first/most common domain).
 */
export function getPrimaryDomain(project) {
    if (!project.branches || project.branches.length === 0) return null;
    // Primary domain is the first branch (sorted by tab count)
    return project.branches[0]?.domain || null;
}

/**
 * Calculate URL overlap between two projects.
 */
export function calculateUrlOverlap(project1, project2) {
    const urls1 = new Set();
    const urls2 = new Set();
    
    if (project1.branches) {
        for (const branch of project1.branches) {
            if (branch.tabs) {
                for (const tab of branch.tabs) {
                    if (tab.url) urls1.add(tab.url);
                }
            }
        }
    }
    
    if (project2.branches) {
        for (const branch of project2.branches) {
            if (branch.tabs) {
                for (const tab of branch.tabs) {
                    if (tab.url) urls2.add(tab.url);
                }
            }
        }
    }
    
    if (urls1.size === 0 || urls2.size === 0) return 0;
    
    let overlap = 0;
    for (const url of urls1) {
        if (urls2.has(url)) overlap++;
    }
    
    return overlap / Math.max(urls1.size, urls2.size);
}

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|
 */
export function calculateJaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;

    let intersectionSize = 0;
    for (const item of setA) {
        if (setB.has(item)) intersectionSize++;
    }

    const unionSize = setA.size + setB.size - intersectionSize;
    return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

// ── Merge projects ───────────────────────────────────────────

/**
 * Merge AI/heuristic projects with manual and pinned projects.
 * Preserves manual projects and pinned projects.
 * Attempts to preserve IDs for similar projects to prevent UI flicker.
 */
export function mergeProjects(aiProjects, existingProjects) {
    // Separate manual, pinned, and auto-detected projects
    const manualProjects = existingProjects.filter((p) => !p.autoDetected);
    const pinnedProjects = existingProjects.filter((p) => p.pinned);
    const autoDetectedProjects = existingProjects.filter((p) => p.autoDetected && !p.pinned);

    // Build index of existing projects for matching
    // Index by normalized name for fast lookup
    const existingProjectsByName = new Map();
    // Also index by primary domain as fallback
    const existingProjectsByDomain = new Map();
    
    for (const p of autoDetectedProjects) {
        const normalizedName = normalizeProjectName(p.name);
        if (!existingProjectsByName.has(normalizedName)) {
            existingProjectsByName.set(normalizedName, []);
        }
        existingProjectsByName.get(normalizedName).push(p);
        
        const primaryDomain = getPrimaryDomain(p);
        if (primaryDomain) {
            if (!existingProjectsByDomain.has(primaryDomain)) {
                existingProjectsByDomain.set(primaryDomain, []);
            }
            existingProjectsByDomain.get(primaryDomain).push(p);
        }
    }

    // Assign IDs to new AI projects, preserving if similar project exists
    const aiProjectsWithIds = aiProjects.map((newProject) => {
        // Strategy 1: Match by exact normalized name
        const normalizedName = normalizeProjectName(newProject.name);
        const candidatesByName = existingProjectsByName.get(normalizedName) || [];
        
        // Strategy 2: Match by primary domain (fallback)
        const primaryDomain = getPrimaryDomain(newProject);
        const candidatesByDomain = primaryDomain ? (existingProjectsByDomain.get(primaryDomain) || []) : [];
        
        // Combine candidates (dedupe by ID)
        const candidateMap = new Map();
        for (const c of [...candidatesByName, ...candidatesByDomain]) {
            candidateMap.set(c.id, c);
        }
        const allCandidates = Array.from(candidateMap.values());
        
        // Find best match by multiple criteria
        let bestMatch = null;
        let bestScore = 0;
        
        for (const existing of allCandidates) {
            if (!existing.branches || existing.branches.length === 0) continue;
            if (!newProject.branches || newProject.branches.length === 0) continue;
            
            // Calculate domain similarity
            const existingDomains = new Set(existing.branches.map(b => b.domain));
            const newDomains = new Set(newProject.branches.map(b => b.domain));
            
            let domainMatchCount = 0;
            for (const domain of newDomains) {
                if (existingDomains.has(domain)) domainMatchCount++;
            }
            
            const domainScore = domainMatchCount / Math.max(existingDomains.size, newDomains.size, 1);
            
            // Calculate name similarity
            const nameScore = nameSimilarity(existing.name, newProject.name);
            
            // Calculate URL overlap
            const urlScore = calculateUrlOverlap(existing, newProject);
            
            // Combined score: prioritize domain overlap, then name, then URLs
            // Lower threshold to 30% domain overlap for better matching
            const combinedScore = (domainScore * 0.5) + (nameScore * 0.3) + (urlScore * 0.2);
            
            // Match if domain overlap >= 30% OR (name similarity >= 0.7 AND primary domain matches)
            const primaryMatches = getPrimaryDomain(existing) === primaryDomain;
            const meetsThreshold = domainScore >= 0.3 || (nameScore >= 0.7 && primaryMatches);
            
            if (meetsThreshold && combinedScore > bestScore) {
                bestScore = combinedScore;
                bestMatch = existing;
            }
        }
        
        // Preserve ID if we found a good match
        if (bestMatch) {
            return {
                ...newProject,
                id: bestMatch.id, // Preserve ID to prevent UI flicker
                starred: bestMatch.starred, // Preserve starred status
            };
        }
        
        return newProject; // Keep new ID
    });

    // Combine: manual + pinned + new AI projects
    const merged = [
        ...manualProjects,
        ...pinnedProjects,
        ...aiProjectsWithIds,
    ];

    return merged;
}

// ── Filter pinned projects ───────────────────────────────────

/**
 * Filter out pinned projects from events before sending to AI.
 * Pinned projects should be excluded from analysis.
 */
export function filterPinnedProjectsFromEvents(events, existingProjects) {
    const pinnedProjects = existingProjects.filter((p) => p.pinned);
    const pinnedUrls = new Set();
    
    // Collect all URLs from pinned projects
    for (const project of pinnedProjects) {
        if (project.branches) {
            for (const branch of project.branches) {
                if (branch.tabs) {
                    for (const tab of branch.tabs) {
                        if (tab.url) {
                            pinnedUrls.add(tab.url);
                        }
                    }
                }
            }
        }
    }
    
    // Filter out events that match pinned project URLs
    return events.filter((e) => !e.url || !pinnedUrls.has(e.url));
}
