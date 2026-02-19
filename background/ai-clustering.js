import { AI } from '../shared/constants.js';
import {
    hasProjectChanges,
    mergeProjects,
    filterPinnedProjectsFromEvents,
} from '../shared/project-utils.js';
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
        
        // API key must be stored via Settings UI or console:
        //   chrome.storage.local.set({ ai_api_key: 'YOUR_KEY' })
        // Get a key from: https://aistudio.google.com/app/apikey
        
        if (apiKey && apiKey.length > 20) {
            console.log('[AI Clustering] Using API key, calling Gemini...', { tabCount: eventsForAnalysis.length });
            aiProjects = await analyzeTabsWithGemini(eventsForAnalysis, apiKey);
            source = 'ai';
            tabsAnalyzed = eventsForAnalysis.length;
            console.log(`[AI Clustering] ✅ AI analysis complete: ${aiProjects.length} projects`);
        } else {
            console.warn('[AI Clustering] ⚠️ No valid API key - using heuristics. To enable AI:');
            console.warn('  1. Get key from: https://aistudio.google.com/app/apikey');
            console.warn('  2. Run in console: chrome.storage.local.set({ai_api_key: "your-key"})');
            console.warn('  3. Or hardcode in ai-clustering.js line ~390');
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
        
        // Fallback to heuristic clustering.
        // runClustering() returns the full project set (including manual/pinned),
        // but mergeProjects() re-adds manual/pinned from existingProjects.
        // Only pass auto-detected projects to avoid duplicating manual ones.
        const heuristicAll = (await runClustering()) || [];
        aiProjects = heuristicAll.filter((p) => p.autoDetected);
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
