import { AI } from '../shared/constants.js';
import { analyzeTabsWithGemini } from './gemini-client.js';
import { runClustering } from './clustering.js';
import {
    getTabEvents,
    getProjects,
    saveProjects,
    getAIApiKey,
} from './storage.js';
import {
    getCachedProjects,
    setCachedProjects,
    getCacheMetadata,
    setCacheMetadata,
    shouldInvalidateCache,
} from './cache.js';

/**
 * AI-first clustering orchestrator.
 * Uses Gemini API for semantic clustering, falls back to heuristics on failure.
 */

/**
 * Check if AI clustering should run based on smart triggers.
 * @param {number} currentTabCount - Current number of tabs
 * @returns {Promise<boolean>}
 */
async function shouldRunAIClustering(currentTabCount) {
    // Don't run if user has too few tabs
    if (currentTabCount < AI.MIN_TABS_FOR_ANALYSIS) {
        return false;
    }

    // Check cache invalidation triggers
    return await shouldInvalidateCache(currentTabCount);
}

/**
 * Get current tab count from events.
 */
async function getCurrentTabCount() {
    const events = await getTabEvents();
    // Count unique URLs from last 24 hours
    const cutoff = Date.now() - (AI.ANALYSIS_WINDOW_HOURS * 60 * 60 * 1000);
    const recentUrls = new Set();
    for (const e of events) {
        if (e.url && e.timestamp >= cutoff) {
            recentUrls.add(e.url);
        }
    }
    return recentUrls.size;
}

/**
 * Check if there are meaningful changes between existing and new projects.
 * Ignores timestamp-only updates.
 */
function hasProjectChanges(existingProjects, newProjects) {
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

/**
 * Normalize project name for fuzzy matching.
 * Removes common variations, extra spaces, and special characters.
 */
function normalizeProjectName(name) {
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
function nameSimilarity(name1, name2) {
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

/**
 * Get primary domain from project (first/most common domain).
 */
function getPrimaryDomain(project) {
    if (!project.branches || project.branches.length === 0) return null;
    // Primary domain is the first branch (sorted by tab count)
    return project.branches[0]?.domain || null;
}

/**
 * Calculate URL overlap between two projects.
 */
function calculateUrlOverlap(project1, project2) {
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
 * Merge AI/heuristic projects with manual and pinned projects.
 * Preserves manual projects and pinned projects.
 * Attempts to preserve IDs for similar projects to prevent UI flicker.
 */
function mergeProjects(aiProjects, existingProjects) {
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

/**
 * Filter out pinned projects from events before sending to AI.
 * Pinned projects should be excluded from analysis.
 */
function filterPinnedProjectsFromEvents(events, existingProjects) {
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

/**
 * Run AI clustering with fallback to heuristics.
 * @param {boolean} force - Force analysis even if triggers not met
 * @returns {Promise<Array>} Array of projects
 */
export async function runAIClustering(force = false) {
    const currentTabCount = await getCurrentTabCount();

    // Check if we should run (unless forced)
    if (!force) {
        const shouldRun = await shouldRunAIClustering(currentTabCount);
        if (!shouldRun) {
            // Return cached projects if available
            const cached = await getCachedProjects();
            if (cached && cached.projects) {
                return cached.projects;
            }
            // No cache and shouldn't run - return existing projects
            return await getProjects();
        }
    }

    console.log('[AI Clustering] Starting analysis...');

    // Get existing projects to preserve manual/pinned
    const existingProjects = await getProjects();
    const events = await getTabEvents();

    // Filter out pinned projects from events before analysis
    const eventsForAnalysis = filterPinnedProjectsFromEvents(events, existingProjects);

    // Try AI clustering first
    let aiProjects = [];
    let source = 'heuristic';
    let tabsAnalyzed = 0;

    try {
        let apiKey = await getAIApiKey();
        
        // For MVP: If no key in storage, you can hardcode it here temporarily
        // TODO: Add UI for API key input in settings
        // Get your API key from: https://aistudio.google.com/app/apikey
        if (!apiKey) {
            // ⚠️ TEMPORARY: Uncomment and add your API key here for testing:
            // apiKey = 'YOUR_ACTUAL_API_KEY_HERE';
            apiKey = 'AIzaSyDHNI1rFi77stLlgvK2tYxB9wH1CfeJ0kI'; // Set to null to skip AI and use heuristics
        }
        
        if (apiKey && apiKey !== 'YOUR_API_KEY_HERE' && apiKey.length > 20) {
            console.log('[AI Clustering] Using API key, calling Gemini...', { tabCount: eventsForAnalysis.length });
            aiProjects = await analyzeTabsWithGemini(eventsForAnalysis, apiKey);
            source = 'ai';
            tabsAnalyzed = eventsForAnalysis.length;
            console.log(`[AI Clustering] ✅ AI analysis complete: ${aiProjects.length} projects`);
        } else {
            console.warn('[AI Clustering] ⚠️ No valid API key - using heuristics. To enable AI:');
            console.warn('  1. Get key from: https://aistudio.google.com/app/apikey');
            console.warn('  2. Run in console: chrome.storage.local.set({ai_api_key: "your-key"})');
            console.warn('  3. Or hardcode in ai-clustering.js line ~142');
            throw new Error('No valid API key configured');
        }
    } catch (error) {
        const isQuotaError = error.message.includes('429') || error.message.includes('quota');
        if (isQuotaError) {
            console.warn('[AI Clustering] ⚠️ API quota exceeded, falling back to heuristics:', error.message);
            console.warn('[AI Clustering] 💡 To fix: Check quota at https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas');
        } else {
            console.warn('[AI Clustering] AI failed, falling back to heuristics:', error.message);
        }
        
        // Fallback to heuristic clustering
        // Note: runClustering() handles its own filtering, but we still want to exclude pinned
        aiProjects = (await runClustering()) || [];
        source = 'heuristic';
        tabsAnalyzed = eventsForAnalysis.length;
        
        // Mark projects with source
        aiProjects = aiProjects.map((p) => ({
            ...p,
            source: 'heuristic',
        }));
        
        console.log(`[AI Clustering] Heuristic fallback complete: ${aiProjects.length} projects`);
    }

    // Filter out AI projects with no tabs before merging
    const validAIProjects = aiProjects.filter((p) => {
        const hasBranches = p.branches && p.branches.length > 0;
        const hasTabs = hasBranches && p.branches.some((b) => b.tabs && b.tabs.length > 0);
        if (!hasTabs) {
            console.warn('[AI Clustering] Filtering out AI project with no tabs:', p.name);
        }
        return hasTabs;
    });

    // Merge with manual/pinned projects
    const finalProjects = mergeProjects(validAIProjects, existingProjects);

    // Stability check: only save if there are meaningful changes
    // Compare with existing projects to avoid unnecessary updates
    const hasMeaningfulChanges = hasProjectChanges(existingProjects, finalProjects);
    
    if (hasMeaningfulChanges) {
        // Save to storage
        await saveProjects(finalProjects);
        console.log('[AI Clustering] Projects saved (meaningful changes detected)');
    } else {
        console.log('[AI Clustering] Skipping save - no meaningful changes detected');
    }

    // Always update cache (for instant UI display) even if we didn't save
    // Cache updates are debounced in popup, so this won't cause excessive re-renders
    await setCachedProjects(finalProjects, source, tabsAnalyzed);
    await setCacheMetadata(currentTabCount);

    console.log(`[AI Clustering] Complete: ${finalProjects.length} total projects (${source})`);

    return finalProjects;
}

/**
 * Check if analysis is needed and run if so.
 * Called by service worker on tab events.
 */
export async function checkAndRunAIClustering() {
    const currentTabCount = await getCurrentTabCount();
    
    if (currentTabCount < AI.MIN_TABS_FOR_ANALYSIS) {
        return; // Not enough tabs yet
    }

    const shouldRun = await shouldRunAIClustering(currentTabCount);
    if (shouldRun) {
        // Run in background (don't await to avoid blocking)
        runAIClustering().catch((err) => {
            console.error('[AI Clustering] Background analysis failed:', err);
        });
    }
}
