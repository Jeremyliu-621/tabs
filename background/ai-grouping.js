/**
 * AI-powered project refinement using Gemini API.
 *
 * This module acts as an enhancement layer on top of the existing
 * heuristic clustering. It sends project data to Gemini, which:
 *   1. Renames projects with descriptive, human-readable names
 *   2. Filters out distraction tabs (e.g., unrelated YouTube videos)
 *   3. Reassigns tabs that fit better in another project
 *   4. Identifies useful content (e.g., tutorial videos) and keeps them
 *
 * Rate-limited to one call per AI.MIN_INTERVAL (5 minutes), and only
 * when the underlying tab data has actually changed.
 */

import { AI } from '../shared/constants.js';
import { getAICache, saveAICache, getAISettings } from './storage.js';
import { CONFIG } from '../config.js';

// ── System Prompt ────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `You are a browser tab organizer for a Chrome extension called "Tabs".

You will receive a list of auto-detected project groups, each containing tabs (URL + title) grouped by domain. Your job is to REFINE these groups into meaningful work projects.

RULES:
1. RENAME each project with a short, descriptive name (2-4 words). Use the actual content to pick names like "ECE110 Lab Report" or "React Side Project" — never generic names like "Project 1" or "Work Stuff".
2. FILTER OUT distraction tabs that don't belong in any work project. Examples:
   - YouTube Shorts, random entertainment videos
   - Social media feeds (Reddit memes, Twitter scrolling)
   - News articles unrelated to any project
   HOWEVER: A YouTube tutorial, a Stack Overflow answer, or a Reddit technical discussion that clearly relates to a project should STAY.
3. REASSIGN tabs if they fit better in a different project. For example, a Stack Overflow question about React should be in the React project, not a Python project.
4. MERGE projects if they are clearly the same thing split across sessions.
5. If a project has only 1 tab after filtering, you may DROP it entirely.

IMPORTANT CONTEXT:
- YouTube watch pages CAN be work-related (tutorials, lectures). Judge by title.
- The same domain (e.g., docs.google.com) can appear in multiple projects.
- Tabs with academic-sounding titles (course names, assignment numbers) are almost always work.
- localhost and 127.0.0.1 URLs are development work — always keep them.

Return ONLY valid JSON matching the required schema. Do not include markdown fences or explanation.`;

// ── Main Entry Point ─────────────────────────────────────────

/**
 * Refine heuristic project candidates using Gemini AI.
 *
 * @param {Array} projects - Array of project objects from heuristic clustering
 * @returns {Array} Refined projects (or the original projects if AI is skipped/fails)
 */
export async function refineProjectsWithAI(projects) {
    // Guard: no projects to refine
    if (!projects || projects.length === 0) return projects;

    // Guard: AI disabled
    const settings = await getAISettings();
    if (!settings.enabled) {
        console.log('[Tabs AI] AI refinement disabled by user.');
        return projects;
    }

    // Guard: no API key
    const apiKey = CONFIG?.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
        console.log('[Tabs AI] No API key configured — skipping AI refinement.');
        return projects;
    }

    // Compute fingerprint of current project data
    const fingerprint = computeFingerprint(projects);

    // Check rate limit and cache
    const cache = await getAICache();
    if (cache) {
        const elapsed = Date.now() - (cache.timestamp || 0);
        if (elapsed < AI.MIN_INTERVAL) {
            console.log(`[Tabs AI] Rate limited — ${Math.round((AI.MIN_INTERVAL - elapsed) / 1000)}s until next call. Using cache.`);
            return cache.fingerprint === fingerprint ? applyAIResults(projects, cache.refinements) : projects;
        }
        if (cache.fingerprint === fingerprint) {
            console.log('[Tabs AI] Data unchanged — using cached results.');
            return applyAIResults(projects, cache.refinements);
        }
    }

    // Build the request payload
    const tabData = serializeProjects(projects);

    try {
        console.log(`[Tabs AI] Calling Gemini (${AI.MODEL})...`);
        const refinements = await callGemini(apiKey, tabData);

        if (refinements && refinements.projects) {
            // Cache the result
            await saveAICache({
                fingerprint,
                refinements,
                timestamp: Date.now(),
            });

            console.log(`[Tabs AI] Refinement complete — ${refinements.projects.length} projects returned.`);
            return applyAIResults(projects, refinements);
        }

        console.warn('[Tabs AI] Invalid response shape — using heuristic results.');
        return projects;
    } catch (err) {
        console.error('[Tabs AI] API call failed:', err.message);
        // Return cached results if available, otherwise fall back to heuristics
        if (cache?.refinements) {
            console.log('[Tabs AI] Falling back to cached AI results.');
            return applyAIResults(projects, cache.refinements);
        }
        return projects;
    }
}

// ── Gemini API Call ──────────────────────────────────────────

async function callGemini(apiKey, tabData) {
    const url = `${AI.API_BASE}/models/${AI.MODEL}:generateContent?key=${apiKey}`;

    const body = {
        system_instruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        contents: [
            {
                role: 'user',
                parts: [
                    {
                        text: `Here are the current auto-detected project groups. Please refine them:\n\n${JSON.stringify(tabData, null, 2)}`,
                    },
                ],
            },
        ],
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'OBJECT',
                properties: {
                    projects: {
                        type: 'ARRAY',
                        description: 'Refined list of projects',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                originalId: {
                                    type: 'STRING',
                                    description: 'The ID of the original project this was derived from (if any)',
                                },
                                name: {
                                    type: 'STRING',
                                    description: 'Short descriptive project name (2-4 words)',
                                },
                                tabs: {
                                    type: 'ARRAY',
                                    description: 'URLs that belong in this project',
                                    items: {
                                        type: 'OBJECT',
                                        properties: {
                                            url: { type: 'STRING' },
                                            title: { type: 'STRING' },
                                        },
                                        required: ['url', 'title'],
                                    },
                                },
                                reasoning: {
                                    type: 'STRING',
                                    description: 'One-sentence explanation of why these tabs are grouped',
                                },
                            },
                            required: ['name', 'tabs'],
                        },
                    },
                    filtered: {
                        type: 'ARRAY',
                        description: 'Tabs removed as distractions',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                url: { type: 'STRING' },
                                reason: { type: 'STRING' },
                            },
                            required: ['url', 'reason'],
                        },
                    },
                },
                required: ['projects'],
            },
            temperature: 0.2,
            maxOutputTokens: 4096,
        },
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        throw new Error('Empty response from Gemini');
    }

    return JSON.parse(text);
}

// ── Apply AI Refinements ─────────────────────────────────────

/**
 * Apply AI refinements back onto the original project objects.
 * Preserves project metadata (id, starred, autoDetected, etc.)
 * while updating names and tab assignments.
 */
function applyAIResults(originalProjects, refinements) {
    if (!refinements?.projects || refinements.projects.length === 0) {
        return originalProjects;
    }

    const result = [];

    for (const aiProject of refinements.projects) {
        // Try to match to an original project by ID
        let base = null;
        if (aiProject.originalId) {
            base = originalProjects.find((p) => p.id === aiProject.originalId);
        }

        // If no ID match, try to match by tab URL overlap
        if (!base) {
            const aiUrls = new Set(aiProject.tabs.map((t) => t.url));
            let bestOverlap = 0;
            for (const orig of originalProjects) {
                const origUrls = getAllUrls(orig);
                let overlap = 0;
                for (const u of origUrls) {
                    if (aiUrls.has(u)) overlap++;
                }
                if (overlap > bestOverlap) {
                    bestOverlap = overlap;
                    base = orig;
                }
            }
        }

        if (base) {
            // Rebuild branches from AI-assigned tabs, grouped by domain
            const domainMap = {};
            for (const tab of aiProject.tabs) {
                let domain;
                try {
                    domain = new URL(tab.url).hostname.replace(/^www\./, '');
                } catch {
                    domain = 'other';
                }
                if (!domainMap[domain]) domainMap[domain] = [];
                if (!domainMap[domain].some((t) => t.url === tab.url)) {
                    domainMap[domain].push({ url: tab.url, title: tab.title });
                }
            }

            const branches = Object.entries(domainMap).map(([domain, tabs]) => ({
                id: base.branches?.find((b) => b.domain === domain)?.id || generateShortId(),
                domain,
                tabs,
            }));

            // Sort branches by tab count (most tabs first)
            branches.sort((a, b) => b.tabs.length - a.tabs.length);

            result.push({
                ...base,
                name: aiProject.name || base.name,
                branches,
                aiRefined: true,
                aiReasoning: aiProject.reasoning || null,
            });
        } else {
            // AI created a brand new project (merged or restructured)
            const domainMap = {};
            for (const tab of aiProject.tabs) {
                let domain;
                try {
                    domain = new URL(tab.url).hostname.replace(/^www\./, '');
                } catch {
                    domain = 'other';
                }
                if (!domainMap[domain]) domainMap[domain] = [];
                if (!domainMap[domain].some((t) => t.url === tab.url)) {
                    domainMap[domain].push({ url: tab.url, title: tab.title });
                }
            }

            const branches = Object.entries(domainMap).map(([domain, tabs]) => ({
                id: generateShortId(),
                domain,
                tabs,
            }));

            branches.sort((a, b) => b.tabs.length - a.tabs.length);

            result.push({
                id: generateShortId(),
                name: aiProject.name,
                autoDetected: true,
                starred: false,
                archived: false,
                lastAccessed: Date.now(),
                createdAt: Date.now(),
                branches,
                aiRefined: true,
                aiReasoning: aiProject.reasoning || null,
            });
        }
    }

    return result;
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Serialize projects into a compact format suitable for the AI prompt.
 */
function serializeProjects(projects) {
    return projects
        .filter((p) => !p.archived && !p.dismissed)
        .slice(0, 15) // cap number of projects
        .map((p) => {
            const tabs = [];
            for (const branch of (p.branches || [])) {
                for (const tab of (branch.tabs || []).slice(0, 10)) {
                    tabs.push({
                        url: tab.url,
                        title: tab.title,
                        domain: branch.domain,
                    });
                }
            }
            return {
                id: p.id,
                currentName: p.name,
                tabs: tabs.slice(0, AI.MAX_TABS_PER_REQUEST),
            };
        });
}

/**
 * Compute a simple fingerprint of project data to detect changes.
 * Uses sorted URLs to be order-independent.
 */
function computeFingerprint(projects) {
    const urls = [];
    for (const p of projects) {
        for (const b of (p.branches || [])) {
            for (const t of (b.tabs || [])) {
                if (t.url) urls.push(t.url);
            }
        }
    }
    urls.sort();
    // Simple hash: join URLs and compute a numeric hash
    const str = urls.join('|');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32-bit integer
    }
    return hash.toString(36);
}

/**
 * Get all URLs from a project's branches.
 */
function getAllUrls(project) {
    const urls = [];
    for (const b of (project.branches || [])) {
        for (const t of (b.tabs || [])) {
            if (t.url) urls.push(t.url);
        }
    }
    return urls;
}

function generateShortId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
