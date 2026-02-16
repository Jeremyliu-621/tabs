import { AI } from '../shared/constants.js';
import { generateId } from '../shared/utils.js';

/**
 * Gemini API client for tab clustering analysis.
 * Handles API communication, timeout, and response parsing.
 */

/**
 * Sanitize URL by removing sensitive query parameters.
 * Keeps pathname and basic structure, removes query params.
 */
function sanitizeUrl(url) {
    try {
        const parsed = new URL(url);
        // Keep pathname, remove query params for privacy
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return url;
    }
}

/**
 * Prepare tab data for AI analysis.
 * Filters to last 24 hours, limits to 100 tabs, sanitizes URLs.
 */
function prepareTabsForAnalysis(events) {
    const now = Date.now();
    const cutoff = now - (AI.ANALYSIS_WINDOW_HOURS * 60 * 60 * 1000);
    
    // Filter to recent events with URLs and titles
    const recentEvents = events
        .filter((e) => {
            if (!e.url || !e.domain) return false;
            if (e.timestamp < cutoff) return false;
            return true;
        })
        .sort((a, b) => b.timestamp - a.timestamp) // Most recent first
        .slice(0, AI.MAX_TABS_TO_ANALYZE);

    // Deduplicate by URL, keeping most recent
    const urlMap = new Map();
    for (const e of recentEvents) {
        const key = e.url;
        if (!urlMap.has(key) || urlMap.get(key).timestamp < e.timestamp) {
            urlMap.set(key, e);
        }
    }

    // Convert to analysis format
    return Array.from(urlMap.values()).map((e) => ({
        domain: e.domain,
        url: sanitizeUrl(e.url),
        title: e.title || '',
        timeSpent: e.focusDuration || 0,
        timestamp: e.timestamp,
    }));
}

/**
 * Build the prompt for Gemini API.
 */
function buildPrompt(tabs) {
    const tabsList = tabs.map((t, i) => 
        `${i + 1}. ${t.domain} - ${t.title || t.url}`
    ).join('\n');

    return `You are a tab organization assistant. Analyze these browser tabs and group them into focused projects based on semantic meaning, not just domain co-occurrence.

TABS TO ANALYZE:
${tabsList}

RULES:
1. Group by topic/context, not domain. Same domain can appear in multiple projects if contexts differ.
2. Filter distractions:
   - YouTube shorts (youtube.com/shorts/*) - ALWAYS remove
   - Spotify appearing in 3+ projects - remove (background music)
   - Instagram alone - remove (scrolling)
   - Keep: YouTube tutorials with coding domains (learning)
   - Keep: Instagram + Canva + Buffer (content creation work)
3. Extract smart names from URLs:
   - Course codes (e.g., "ECE110", "APS105", "MAT292")
   - Repository names (e.g., "my-project" from github.com/user/my-project)
   - Client names from URLs
4. Return JSON in this exact format:
{
  "projects": [
    {
      "name": "Project Name",
      "tabs": [
        {"url": "https://example.com/page", "title": "Page Title"}
      ],
      "filteredTabs": ["https://youtube.com/shorts/xyz"],
      "confidence": 0.85
    }
  ]
}

Return ONLY valid JSON, no markdown, no code blocks.`;
}

/**
 * Parse Gemini API response and convert to project structure.
 */
function parseResponse(responseText) {
    try {
        // Remove markdown code blocks if present
        let cleaned = responseText.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        
        const parsed = JSON.parse(cleaned);
        
        if (!parsed.projects || !Array.isArray(parsed.projects)) {
            throw new Error('Invalid response structure: missing projects array');
        }

        // Convert to project format matching existing structure
        const projects = parsed.projects.map((p) => {
            if (!p.name || !p.tabs || !Array.isArray(p.tabs)) {
                throw new Error('Invalid project structure');
            }

            // Group tabs by domain
            const domainMap = new Map();
            for (const tab of p.tabs) {
                try {
                    const url = new URL(tab.url);
                    const domain = url.hostname.replace(/^www\./, '');
                    
                    if (!domainMap.has(domain)) {
                        domainMap.set(domain, []);
                    }
                    domainMap.get(domain).push({
                        url: tab.url,
                        title: tab.title || '',
                    });
                } catch {
                    // Skip invalid URLs
                }
            }

            // Build branches (one per domain)
            const branches = Array.from(domainMap.entries()).map(([domain, tabs]) => ({
                id: generateId(),
                domain,
                tabs: tabs.slice(0, 15), // Cap tabs per branch
            }));

            // Sort branches by number of tabs
            branches.sort((a, b) => b.tabs.length - a.tabs.length);

            return {
                id: generateId(),
                name: p.name,
                autoDetected: true,
                starred: false,
                archived: false,
                lastAccessed: Date.now(),
                createdAt: Date.now(),
                branches,
                source: 'ai',
                confidence: p.confidence || 0.5,
            };
        });

        return projects;
    } catch (error) {
        console.error('[Gemini] Failed to parse response:', error);
        throw new Error(`Invalid API response: ${error.message}`);
    }
}

/**
 * Analyze tabs using Gemini API.
 * @param {Array} events - Tab events from storage
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Array>} Array of projects
 */
export async function analyzeTabsWithGemini(events, apiKey) {
    if (!apiKey) {
        throw new Error('API key required');
    }

    // Prepare tabs for analysis
    const tabs = prepareTabsForAnalysis(events);
    
    if (tabs.length === 0) {
        throw new Error('No tabs to analyze');
    }

    // Build prompt
    const prompt = buildPrompt(tabs);

    // Create request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI.REQUEST_TIMEOUT);

    try {
        const response = await fetch(
            `${AI.GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt,
                        }],
                    }],
                }),
                signal: controller.signal,
            }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        
        // Extract text from Gemini response
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
            throw new Error('No response text from API');
        }

        // Parse and return projects
        return parseResponse(responseText);
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
            throw new Error('Request timeout');
        }
        
        throw error;
    }
}
