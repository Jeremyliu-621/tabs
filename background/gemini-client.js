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
 * Build sessions from events (reused from clustering.js logic).
 */
function buildSessions(events, sessionGap = 15 * 60 * 1000) {
    const sorted = [...events]
        .filter((e) => e.domain && e.timestamp)
        .sort((a, b) => a.timestamp - b.timestamp);

    if (sorted.length === 0) return [];

    const sessions = [];
    let current = {
        id: `session_${sorted[0].timestamp}`,
        start: sorted[0].timestamp,
        end: sorted[0].timestamp,
        events: [sorted[0]],
        domains: new Set([sorted[0].domain]),
    };

    for (let i = 1; i < sorted.length; i++) {
        const e = sorted[i];
        if (e.timestamp - current.end > sessionGap) {
            sessions.push(current);
            current = {
                id: `session_${e.timestamp}`,
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

/**
 * Prepare tab data for AI analysis.
 * Filters to last 24 hours, limits to 100 tabs, sanitizes URLs.
 * Returns tabs with lastAccessed, focusTime, sessionId matching buildPrompt expectations.
 */
function prepareTabsForAnalysis(events) {
    const now = Date.now();
    const cutoff = now - (AI.ANALYSIS_WINDOW_HOURS * 60 * 60 * 1000);
    
    // Build sessions to assign sessionIds to tabs
    const sessions = buildSessions(events);
    const sessionMap = new Map();
    for (const session of sessions) {
        for (const event of session.events) {
            if (event.url) {
                sessionMap.set(event.url, session.id);
            }
        }
    }
    
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

    // Convert to analysis format matching buildPrompt expectations
    return Array.from(urlMap.values()).map((e) => ({
        domain: e.domain,
        url: sanitizeUrl(e.url),
        title: e.title || '',
        focusTime: e.focusDuration || 0, // Map timeSpent → focusTime
        lastAccessed: e.timestamp, // Map timestamp → lastAccessed
        sessionId: sessionMap.get(e.url) || null, // Add sessionId
    }));
}

/**
 * Build the prompt for Gemini API.
 */
function buildPrompt(tabs, sessions = []) {
    const now = Date.now();

    const tabsList = tabs.map((t, i) => {
        const minutesAgo = Math.round((now - t.lastAccessed) / 60000);
        const focusSecs = Math.round((t.focusTime || 0) / 1000);
        const recency = minutesAgo < 60
            ? `${minutesAgo}m ago`
            : minutesAgo < 1440
                ? `${Math.round(minutesAgo / 60)}h ago`
                : `${Math.round(minutesAgo / 1440)}d ago`;

        return `TAB ${i + 1}:
  URL: ${t.url}
  Title: ${t.title || '(no title)'}
  Domain: ${t.domain}
  Focus time: ${focusSecs}s
  Last accessed: ${recency}
  Session: ${t.sessionId || 'unknown'}`;
    }).join('\n\n');

    const sessionsList = sessions.length > 0
        ? sessions.map(s => {
            const start = new Date(s.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const end = new Date(s.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `  ${s.id}: ${start} - ${end} | Domains: ${s.domains.join(', ')}`;
        }).join('\n')
        : '  (no session data)';

    return `You are the core intelligence of a Chrome extension called "Tabs".

PRODUCT CONTEXT:
Tabs automatically detects which browser tabs belong together and lets users switch between active projects with one click. When a user switches to a project, it closes all current tabs and opens exactly the right tabs for that project — clean, focused, no clutter. A wrong grouping means the user opens a "project" and gets tabs from three different contexts mixed together. That ruins the experience. Accuracy is everything.

YOUR JOB:
Analyze the user's browsing data and group their tabs into meaningful, focused projects. Group by semantic meaning and context — not by domain. The same domain can and should appear in multiple projects if the context differs.

SESSIONS (tabs open at the same time are likely related):
${sessionsList}

TABS TO ANALYZE:
${tabsList}

FILTERING RULES:
Judge every tab by context, not just domain. The same site can be work or distraction.

YouTube:
- youtube.com/shorts/* → ALWAYS filter, no exceptions
- youtube.com/watch + same session as github/stackoverflow/docs → KEEP (it's a tutorial)
- youtube.com/@channel + same session as canva/buffer/instagram → KEEP (content creation)
- youtube.com/watch with <30s focus time → FILTER (accidental preview)

Spotify / background audio:
- Appears across 3+ unrelated sessions → FILTER from all (it's background music)
- Only appears in one session alongside music production tools → KEEP

Instagram / social media:
- instagram.com alone, or with unrelated tabs → FILTER (scrolling)
- instagram.com + canva.com + buffer.com → KEEP (social media management work)

Focus time signals:
- <15s total focus → almost certainly accidental, filter unless URL is clearly important
- >300s focus → user was actively working here, always keep

Recency signals:
- Not accessed in 7+ days → flag as stale, still include but note it

NAMING RULES:
- Extract course codes: ECE110, MAT292, APS105 → use them
- Extract repo names: github.com/user/my-project → "My Project"
- Extract client names from subdomains or URL paths
- Be specific: "ECE110 Lab 3 — Op Amps" not "School Work"
- Keep names under 50 characters

EXAMPLES:

Example 1 — same domain, different projects:
Tabs: github.com/alex/personal-blog (session A, 1800s focus) + overleaf.com/ece110-lab (session A) + github.com/alex/client-acme (session B, 900s focus) + slack.com/acmecorp (session B)
Output:
  Project "Personal Blog": github/personal-blog, overleaf/ece110-lab
  Project "Acme Corp Client": github/client-acme, slack/acmecorp
  → github.com appears in both. Correct. Different repos = different projects.

Example 2 — shared tool (Canva) in multiple projects:
Tabs: canva.com/instagram-post (session A) + instagram.com/insights (session A) + buffer.com (session A) + canva.com/ece-poster (session B) + quercus.utoronto.ca/ECE110 (session B)
Output:
  Project "Instagram Content": canva/instagram-post, instagram/insights, buffer
  Project "ECE110 Poster": canva/ece-poster, quercus/ECE110
  → Canva in both. Correct. Context determines the project, not the tool.

Example 3 — YouTube as work vs distraction:
Tabs: youtube.com/watch?v=react-tutorial (session A, 900s, with github + localhost) + youtube.com/shorts/xyz (session A, 20s) + youtube.com/watch?v=funny-video (session B, 30s)
Output:
  Keep: youtube react-tutorial (tutorial, coding session, long focus)
  Filter: youtube/shorts/xyz (always filter)
  Filter: youtube funny-video (30s focus, entertainment)

RULES FOR EDGE CASES:
- Truly ambiguous tab with no clear session context → assign to most recently active project
- Single-tab projects → avoid if possible, merge into nearest relevant project
- Stale tabs (7d+ old) → include but add "lastActive" field in output

OUTPUT FORMAT:
Return ONLY valid JSON. No markdown. No code blocks. No explanation outside the JSON.

{
  "projects": [
    {
      "name": "ECE110 Lab 3 — Op Amps",
      "tabs": [
        { "url": "https://quercus.utoronto.ca/courses/ECE110", "title": "ECE110 Assignments" },
        { "url": "https://overleaf.com/project/lab3", "title": "Lab Report 3" }
      ],
      "reasoning": "Course code ECE110 in URLs, LaTeX editor and course portal in same session",
      "confidence": 0.95
    }
  ],
  "filtered": [
    {
      "url": "https://youtube.com/shorts/abc",
      "reason": "Short-form content, always filtered"
    }
  ]
}`;
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
        
        console.log('[Gemini] Parsed response:', {
            hasProjects: !!parsed.projects,
            projectsCount: parsed.projects?.length || 0,
            firstProject: parsed.projects?.[0],
        });
        
        if (!parsed.projects || !Array.isArray(parsed.projects)) {
            throw new Error('Invalid response structure: missing projects array');
        }

        // Convert to project format matching existing structure
        const projects = parsed.projects.map((p) => {
            if (!p.name) {
                throw new Error('Invalid project structure: missing name');
            }
            if (!p.tabs || !Array.isArray(p.tabs)) {
                console.warn('[Gemini] Project missing tabs array:', p.name, p);
                // Create empty branches if no tabs
                return {
                    id: generateId(),
                    name: p.name,
                    autoDetected: true,
                    starred: false,
                    archived: false,
                    lastAccessed: Date.now(),
                    createdAt: Date.now(),
                    branches: [],
                    source: 'ai',
                    confidence: p.confidence || 0.5,
                };
            }

            // Log raw project structure for debugging
            console.log('[Gemini] Processing project:', p.name, {
                tabsType: typeof p.tabs,
                tabsLength: p.tabs?.length,
                firstTab: p.tabs?.[0],
                firstTabType: typeof p.tabs?.[0]
            });
            
            // Group tabs by domain
            const domainMap = new Map();
            let validTabsCount = 0;
            let invalidTabsCount = 0;
            
            for (const tab of p.tabs) {
                let tabUrl = '';
                let tabTitle = '';
                
                // Handle string tabs (plain URLs)
                if (typeof tab === 'string') {
                    tabUrl = tab;
                    tabTitle = '';
                } else if (tab && typeof tab === 'object') {
                    // Handle object tabs with various field names
                    // Try multiple possible field names for URL
                    tabUrl = tab.url || tab.link || tab.href || '';
                    // Handle nested URL objects
                    if (!tabUrl && tab.url && typeof tab.url === 'object') {
                        tabUrl = tab.url.url || tab.url.href || tab.url.link || '';
                    }
                    // Try multiple possible field names for title
                    tabTitle = tab.title || tab.name || tab.label || '';
                    // Handle nested title objects
                    if (!tabTitle && tab.url && typeof tab.url === 'object') {
                        tabTitle = tab.url.title || tab.url.name || '';
                    }
                } else {
                    // Invalid tab format
                    invalidTabsCount++;
                    console.warn('[Gemini] Skipping invalid tab format:', tab);
                    continue;
                }
                
                if (!tabUrl) {
                    invalidTabsCount++;
                    console.warn('[Gemini] Skipping tab with no URL:', tab);
                    continue;
                }
                
                try {
                    // Ensure URL is absolute (add https:// if missing)
                    let fullUrl = tabUrl;
                    if (!tabUrl.startsWith('http://') && !tabUrl.startsWith('https://')) {
                        fullUrl = 'https://' + tabUrl;
                    }
                    
                    const url = new URL(fullUrl);
                    const domain = url.hostname.replace(/^www\./, '');
                    
                    if (!domainMap.has(domain)) {
                        domainMap.set(domain, []);
                    }
                    domainMap.get(domain).push({
                        url: fullUrl,
                        title: tabTitle,
                    });
                    validTabsCount++;
                } catch (e) {
                    // Skip invalid URLs
                    invalidTabsCount++;
                    console.warn('[Gemini] Skipping invalid URL:', tabUrl, e);
                }
            }
            
            if (invalidTabsCount > 0) {
                console.warn(`[Gemini] Skipped ${invalidTabsCount} invalid tabs in project "${p.name}"`);
            }

            // Build branches (one per domain)
            const branches = domainMap.size > 0
                ? Array.from(domainMap.entries()).map(([domain, tabs]) => ({
                    id: generateId(),
                    domain,
                    tabs: tabs.slice(0, 15), // Cap tabs per branch
                }))
                : [];

            // Sort branches by number of tabs (most active domain first)
            branches.sort((a, b) => b.tabs.length - a.tabs.length);

            // CRITICAL: Never return a project with empty branches
            // If all tabs failed parsing, skip this project entirely
            if (branches.length === 0 || validTabsCount === 0) {
                console.error('[Gemini] CRITICAL: Project has no valid branches after processing tabs - SKIPPING:', {
                    name: p.name,
                    tabsCount: p.tabs?.length || 0,
                    validTabsCount,
                    invalidTabsCount,
                    sampleTabs: p.tabs?.slice(0, 3), // Show first 3 tabs for debugging
                });
                // Return null to signal this project should be filtered out
                return null;
            }

            // Validate branch structure before proceeding
            for (const branch of branches) {
                if (!branch.domain || !Array.isArray(branch.tabs) || branch.tabs.length === 0) {
                    console.error('[Gemini] CRITICAL: Invalid branch structure detected:', branch);
                    // This should never happen, but if it does, skip the project
                    return null;
                }
            }

            console.log('[Gemini] Created project with branches:', {
                name: p.name,
                branchesCount: branches.length,
                totalTabs: branches.reduce((sum, b) => sum + b.tabs.length, 0),
            });

            // At this point, branches is guaranteed to be non-empty and valid
            const project = {
                id: generateId(),
                name: p.name,
                autoDetected: true,
                starred: false,
                archived: false,
                lastAccessed: Date.now(),
                createdAt: Date.now(),
                branches, // Already validated: [{ domain, tabs: [{ url, title }] }]
                source: 'ai',
                confidence: p.confidence || 0.5,
            };

            // Final validation - this should never fail if we got here
            if (!project.branches || !Array.isArray(project.branches) || project.branches.length === 0) {
                console.error('[Gemini] CRITICAL: Project branches validation failed - this should never happen!', project);
                return null; // Skip this project
            }

            // Validate each branch has the correct structure
            for (const branch of project.branches) {
                if (!branch.domain || !Array.isArray(branch.tabs) || branch.tabs.length === 0) {
                    console.error('[Gemini] CRITICAL: Invalid branch structure in final validation:', branch);
                    return null; // Skip this project
                }
            }

            return project;
        });

        // Filter out null projects (projects that failed validation)
        const validProjects = projects.filter((p) => {
            if (!p) {
                return false; // Filter out null projects
            }
            
            // Double-check: ensure branches exist and have tabs
            const hasBranches = p.branches && Array.isArray(p.branches) && p.branches.length > 0;
            const hasTabs = hasBranches && p.branches.some((b) => b.tabs && Array.isArray(b.tabs) && b.tabs.length > 0);
            
            if (!hasTabs) {
                console.warn('[Gemini] Filtering out project with no tabs (should not happen):', p.name);
            }
            
            return hasTabs;
        });

        if (validProjects.length < projects.length) {
            console.warn(`[Gemini] Filtered out ${projects.length - validProjects.length} projects with no valid tabs`);
        }

        return validProjects;
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

    // Build sessions from events for context
    const sessions = buildSessions(events);
    const sessionsForPrompt = sessions.map(s => ({
        id: s.id,
        start: s.start,
        end: s.end,
        domains: Array.from(s.domains),
    }));

    // Prepare tabs for analysis
    const tabs = prepareTabsForAnalysis(events);
    
    if (tabs.length === 0) {
        throw new Error('No tabs to analyze');
    }

    // Build prompt with sessions
    const prompt = buildPrompt(tabs, sessionsForPrompt);

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
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch {
                errorData = { error: { message: errorText } };
            }
            
            // Handle quota errors with helpful message
            if (response.status === 429) {
                const retryDelay = errorData.error?.details?.find(d => d['@type']?.includes('RetryInfo'))?.retryDelay;
                const message = errorData.error?.message || 'Quota exceeded';
                throw new Error(`API quota exceeded (429). ${retryDelay ? `Retry in ${retryDelay}` : 'Please check your API quota limits.'} - ${message}`);
            }
            
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
