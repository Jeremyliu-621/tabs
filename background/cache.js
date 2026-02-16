import { STORAGE_KEYS } from '../shared/constants.js';
import { getAICache, saveAICache, getAIMetadata, saveAIMetadata } from './storage.js';

/**
 * Caching layer for AI clustering results.
 * Provides instant read for popup UI and tracks cache invalidation.
 */

const CACHE_KEY = 'ai_cache';
const METADATA_KEY = 'ai_analysis_metadata';

/**
 * Get cached projects.
 * @returns {Promise<{projects: Array, timestamp: number, source: string, tabsAnalyzed: number} | null>}
 */
export async function getCachedProjects() {
    return await getAICache();
}

/**
 * Set cached projects.
 * @param {Array} projects - Projects array
 * @param {string} source - 'ai' or 'heuristic'
 * @param {number} tabsAnalyzed - Number of tabs analyzed
 */
export async function setCachedProjects(projects, source, tabsAnalyzed) {
    const cache = {
        projects,
        timestamp: Date.now(),
        source,
        tabsAnalyzed,
    };
    await saveAICache(cache);
    return cache;
}

/**
 * Get cache metadata (last analysis time, tab count).
 * @returns {Promise<{lastAnalysisTime: number, tabsAtLastAnalysis: number}>}
 */
export async function getCacheMetadata() {
    return await getAIMetadata();
}

/**
 * Set cache metadata.
 * @param {number} tabsCount - Current tab count
 */
export async function setCacheMetadata(tabsCount) {
    await saveAIMetadata({
        lastAnalysisTime: Date.now(),
        tabsAtLastAnalysis: tabsCount,
    });
}

/**
 * Check if cache should be invalidated.
 * Cache is invalid if:
 * - 5+ new tabs since last analysis
 * - OR 5 minutes elapsed since last analysis
 * @param {number} currentTabCount - Current number of tabs
 * @returns {Promise<boolean>}
 */
export async function shouldInvalidateCache(currentTabCount) {
    const metadata = await getCacheMetadata();
    const now = Date.now();
    
    // Check time trigger (5 minutes)
    const timeElapsed = now - metadata.lastAnalysisTime;
    const FIVE_MINUTES = 5 * 60 * 1000;
    if (timeElapsed >= FIVE_MINUTES) {
        return true;
    }
    
    // Check tab count trigger (5+ new tabs)
    const newTabs = currentTabCount - metadata.tabsAtLastAnalysis;
    if (newTabs >= 5) {
        return true;
    }
    
    return false;
}

/**
 * Clear the cache.
 */
export async function clearCache() {
    await saveAICache(null);
    await saveAIMetadata(null);
}
