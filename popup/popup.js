/**
 * Tabs Popup — Project Dashboard + Settings + Debug View
 *
 * Projects view: auto-detected project list with expandable branches,
 * one-click switching, starring, manual project creation, and archived section.
 *
 * Settings view: editable clustering parameters and domain blacklist.
 *
 * Debug view: domain frequencies, co-occurrence, sessions, event log.
 */

import {
    getDebugAnalytics,
    getProjects,
    saveProjects,
    getUserBlacklist,
    saveUserBlacklist,
    getClusteringSettings,
    saveClusteringSettings,
    getTabEvents,
} from '../background/storage.js';
import { TRACKING, CLUSTERING } from '../shared/constants.js';
import { getCachedProjects, shouldInvalidateCache } from '../background/cache.js';

// ── Init ─────────────────────────────────────────────────────

async function init() {
    setupViewToggle();
    setupDebugTabs();
    setupModal();
    setupSettings();

    document.getElementById('btn-refresh').addEventListener('click', async () => {
        // Trigger AI re-clustering in the background
        showUpdatingIndicator();
        chrome.runtime.sendMessage({ action: 'runAIClustering' }, (response) => {
            if (response && response.success) {
                loadData();
            } else {
                hideUpdatingIndicator();
                console.error('[Popup] Clustering failed:', response?.error);
            }
        });
    });

    await loadData();

    // Auto-refresh every 10 seconds so projects stay up-to-date
    let refreshTimer = setInterval(() => loadData(), 10_000);

    // Pause when popup loses focus, resume on refocus
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(refreshTimer);
        } else {
            loadData();
            refreshTimer = setInterval(() => loadData(), 10_000);
        }
    });
}

// Track loading state to prevent concurrent loads
let isLoadingData = false;
let lastRenderedTimestamp = 0;

async function loadData() {
    // Prevent concurrent loads
    if (isLoadingData) {
        return;
    }
    
    isLoadingData = true;
    
    try {
        // 1. Load cached projects immediately for instant display (only if newer)
        const cached = await getCachedProjects();
        if (cached && cached.projects && cached.timestamp > lastRenderedTimestamp) {
            const visible = cached.projects.filter((p) => !p.dismissed);
            const active = visible.filter((p) => !p.archived);
            const archived = visible.filter((p) => p.archived);
            renderProjects(active);
            renderArchivedProjects(archived);
            lastRenderedTimestamp = cached.timestamp;
        }

        // 2. Check if analysis is needed and trigger in background
        // Get current tab count from events
        const events = await getTabEvents();
        const currentTabCount = new Set(events.filter(e => e.url).map(e => e.url)).size;
        if (await shouldInvalidateCache(currentTabCount)) {
            showUpdatingIndicator();
            // Trigger analysis in background
            chrome.runtime.sendMessage({ action: 'runAIClustering' }, () => {
                // Analysis will update cache, which triggers storage listener
            });
        }

        // 3. Load full data (analytics, etc.)
        const [analytics, projects] = await Promise.all([
            getDebugAnalytics(),
            getProjects(),
        ]);

        // Filter out dismissed, then split active and archived
        const visible = projects.filter((p) => !p.dismissed);
        const active = visible.filter((p) => !p.archived);
        const archived = visible.filter((p) => p.archived);

        // Only re-render if data actually changed (compare with cached timestamp)
        const projectsTimestamp = Date.now(); // Use current time as projects timestamp
        if (projectsTimestamp > lastRenderedTimestamp) {
            renderProjects(active);
            renderArchivedProjects(archived);
            lastRenderedTimestamp = projectsTimestamp;
        }
        
        // Always update analytics (they don't cause project re-renders)
        renderDomains(analytics.domainFrequency);
        renderConnections(analytics.coOccurrencePairs);
        renderSessions(analytics.sessions);
        renderEventLog(analytics.recentEvents);

        hideUpdatingIndicator();
    } catch (err) {
        console.error('[Tabs] Popup error:', err);
        hideUpdatingIndicator();
    } finally {
        isLoadingData = false;
    }
}

// ── Loading indicators ────────────────────────────────────────

function showUpdatingIndicator() {
    const indicator = document.getElementById('updating-indicator');
    if (indicator) {
        indicator.classList.remove('hidden');
    }
}

function hideUpdatingIndicator() {
    const indicator = document.getElementById('updating-indicator');
    if (indicator) {
        indicator.classList.add('hidden');
    }
}

// Debounce storage listener to prevent rapid re-renders
let storageUpdateTimer = null;
let lastCacheTimestamp = 0;

// Listen for cache updates
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.ai_cache) {
        // Check if cache actually changed (compare timestamps)
        const newCache = changes.ai_cache.newValue;
        const newTimestamp = newCache?.timestamp || 0;
        
        // Only reload if timestamp is newer (cache actually updated)
        if (newTimestamp > lastCacheTimestamp) {
            lastCacheTimestamp = newTimestamp;
            
            // Debounce: wait 200ms before reloading to batch rapid updates
            if (storageUpdateTimer) {
                clearTimeout(storageUpdateTimer);
            }
            
            storageUpdateTimer = setTimeout(() => {
                loadData();
                storageUpdateTimer = null;
            }, 200);
        }
    }
});

// ── View toggle (Projects / Settings / Debug) ────────────────

function setupViewToggle() {
    const buttons = document.querySelectorAll('.view-btn');
    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            buttons.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.view-panel').forEach((p) => p.classList.remove('active'));
            document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
        });
    });
}

// ── Debug tabs ───────────────────────────────────────────────

function setupDebugTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            buttons.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
            document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
        });
    });
}

// ══════════════════════════════════════════════════════════════
// PROJECTS
// ══════════════════════════════════════════════════════════════

// Track rendered projects to enable diffing
let renderedProjects = new Map(); // projectId -> project data hash

/**
 * Generate a hash of project data for comparison.
 * Only includes properties that affect visual display.
 * Excludes lastAccessed to prevent false positives from timestamp updates.
 */
function projectHash(project) {
    if (!project) return '';
    
    // Hash based on key properties that affect display (excluding lastAccessed)
    const key = `${project.id}|${project.name}|${project.branches?.length || 0}|${project.starred}|${project.archived}`;
    
    // Include actual branch/tab content, not just counts
    // This ensures we detect when tabs are added/removed or branches change
    const branchInfo = project.branches?.map(b => {
        const tabUrls = b.tabs?.map(t => t.url).sort().join(',') || '';
        return `${b.domain}:${b.tabs?.length || 0}:${tabUrls.substring(0, 100)}`; // Limit URL length for hash
    }).join('|') || '';
    
    return `${key}|${branchInfo}`;
}

function renderProjects(projects) {
    const list = document.getElementById('project-list');
    const empty = document.getElementById('projects-empty');

    if (!projects || projects.length === 0) {
        // Clear all if no projects
        list.querySelectorAll('.project-card').forEach((c) => c.remove());
        renderedProjects.clear();
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    // Build map of incoming projects by ID
    const incomingProjects = new Map();
    const incomingIds = new Set();
    
    for (const project of projects) {
        if (!project.id) {
            console.warn('[Popup] Project missing ID:', project);
            continue;
        }
        incomingProjects.set(project.id, project);
        incomingIds.add(project.id);
    }

    // Remove projects that no longer exist
    for (const [projectId, card] of renderedProjects.entries()) {
        if (!incomingIds.has(projectId)) {
            const cardEl = list.querySelector(`[data-project-id="${projectId}"]`);
            if (cardEl) {
                cardEl.remove();
            }
            renderedProjects.delete(projectId);
        }
    }

    // Update or create projects
    for (const project of projects) {
        if (!project.id) continue;
        
        const existingHash = renderedProjects.get(project.id);
        const newHash = projectHash(project);
        
        // Find existing card
        const existingCard = list.querySelector(`[data-project-id="${project.id}"]`);
        
        // Only update if project actually changed
        if (existingHash === newHash && existingCard) {
            // No changes, skip update
            continue;
        }

        // Project changed or doesn't exist - create/update card
        if (existingCard) {
            // Update existing card in place
            const newCard = createProjectCard(project);
            existingCard.replaceWith(newCard);
        } else {
            // Create new card and append
            const card = createProjectCard(project);
            list.appendChild(card);
        }
        
        // Update hash
        renderedProjects.set(project.id, newHash);
    }
    
    // Reorder cards to match projects array order (only if order actually changed)
    const currentCards = Array.from(list.querySelectorAll('.project-card'));
    const projectIds = projects.map(p => p.id).filter(Boolean);
    
    // Check if order is correct by comparing current order with desired order
    let needsReorder = false;
    if (currentCards.length !== projectIds.length) {
        needsReorder = true; // Different number of cards
    } else {
        // Check if each card is in the correct position
        for (let i = 0; i < currentCards.length; i++) {
            if (currentCards[i].dataset.projectId !== projectIds[i]) {
                needsReorder = true;
                break;
            }
        }
    }
    
    // Only reorder if order actually changed
    if (needsReorder && projectIds.length > 0) {
        // Use DocumentFragment to batch DOM operations
        const fragment = document.createDocumentFragment();
        for (const projectId of projectIds) {
            const card = list.querySelector(`[data-project-id="${projectId}"]`);
            if (card) {
                fragment.appendChild(card); // This removes card from list automatically
            }
        }
        // Clear list and append all cards in correct order
        list.innerHTML = '';
        list.appendChild(fragment);
    }
}

function createProjectCard(project, isArchived = false) {
    const card = document.createElement('div');
    card.className = `project-card${isArchived ? ' project-card--archived' : ''}`;
    card.dataset.projectId = project.id;

    // ── Header row
    const header = document.createElement('div');
    header.className = 'project-header';
    
    // Source badge
    const sourceBadge = project.source === 'ai' 
        ? '<span class="source-badge source-badge--ai" title="AI Enhanced">✨</span>'
        : project.autoDetected 
            ? '<span class="source-badge source-badge--heuristic" title="Auto-detected">Auto-detected</span>'
            : '';
    
    header.innerHTML = `
    <span class="project-expand">▶</span>
    <span class="project-name">${esc(project.name)}</span>
    ${sourceBadge}
    <div class="project-meta">
      <span class="project-time">${formatTimeAgo(project.lastAccessed)}</span>
      <button class="project-star ${project.starred ? 'starred' : ''}"
              title="Star project">${project.starred ? '★' : '☆'}</button>
    </div>
  `;

    // Restore expanded state from localStorage
    const expandedIds = JSON.parse(localStorage.getItem('tabs_expanded_projects') || '[]');
    if (expandedIds.includes(project.id)) {
        card.classList.add('expanded');
    }

    header.addEventListener('click', (e) => {
        if (e.target.closest('.project-star')) return;
        if (e.target.closest('.project-name-edit')) return;
        card.classList.toggle('expanded');

        // Persist expanded state
        const isExpanded = card.classList.contains('expanded');
        const currentExpanded = JSON.parse(localStorage.getItem('tabs_expanded_projects') || '[]');
        if (isExpanded) {
            if (!currentExpanded.includes(project.id)) currentExpanded.push(project.id);
        } else {
            const idx = currentExpanded.indexOf(project.id);
            if (idx > -1) currentExpanded.splice(idx, 1);
        }
        localStorage.setItem('tabs_expanded_projects', JSON.stringify(currentExpanded));
    });

    // Star button
    const starBtn = header.querySelector('.project-star');
    starBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        project.starred = !project.starred;
        starBtn.textContent = project.starred ? '★' : '☆';
        starBtn.classList.toggle('starred', project.starred);
        // Persist
        const allProjects = await getProjects();
        const p = allProjects.find((x) => x.id === project.id);
        if (p) {
            p.starred = project.starred;
            await saveProjects(allProjects);
        }
    });

    // ── Branches
    const branchContainer = document.createElement('div');
    branchContainer.className = 'project-branches';

    // Debug: Log branch data
    if (!project.branches) {
        console.warn('[Popup] Project has no branches property:', project.name, project);
    } else if (project.branches.length === 0) {
        console.warn('[Popup] Project has empty branches array:', project.name);
    }

    if (project.branches && project.branches.length > 0) {
        // Check if project name matches single branch domain
        const normalizedProjectName = normalizeForComparison(project.name);
        const hasSingleBranch = project.branches.length === 1;
        const singleBranch = hasSingleBranch ? project.branches[0] : null;
        const normalizedBranchDomain = singleBranch ? normalizeForComparison(cleanBranchDomain(singleBranch.domain)) : '';
        const shouldSkipBranchDisplay = hasSingleBranch && normalizedProjectName === normalizedBranchDomain;

        if (shouldSkipBranchDisplay) {
            // Skip branch structure, show tabs directly
            const tabList = document.createElement('div');
            tabList.className = 'branch-tabs';
            tabList.style.cssText = 'padding-left: 0;'; // Remove left padding since no branch header

            // Deduplicate tabs by title
            const seenTitles = new Set();
            const uniqueTabs = singleBranch.tabs.filter((t) => {
                if (seenTitles.has(t.title)) return false;
                seenTitles.add(t.title);
                return true;
            });

            const displayTabs = uniqueTabs.slice(0, 10); // Show more tabs when no branch structure
            for (let i = 0; i < displayTabs.length; i++) {
                const tab = displayTabs[i];
                const isTabLast = i === displayTabs.length - 1 && uniqueTabs.length <= 10;
                const tabEl = document.createElement('div');
                tabEl.className = 'branch-tab';
                tabEl.innerHTML = `
                    <span class="branch-tab-prefix">${isTabLast ? '└' : '├'}</span>
                    <a class="branch-tab-link" title="${esc(tab.title)}">${esc(tab.title)}</a>
                `;
                tabEl.querySelector('.branch-tab-link').addEventListener('click', () => {
                    chrome.runtime.sendMessage({ action: 'openTabs', urls: [tab.url] });
                });
                tabList.appendChild(tabEl);
            }

            if (uniqueTabs.length > 10) {
                const more = document.createElement('div');
                more.className = 'branch-tab';
                more.innerHTML = `<span class="branch-tab-prefix">└</span><span class="branch-tab-link">+${uniqueTabs.length - 10} more</span>`;
                tabList.appendChild(more);
            }

            branchContainer.appendChild(tabList);
        } else {
            // Show normal branch structure
            const grid = document.createElement('div');
            grid.className = 'branch-grid';

            for (let i = 0; i < project.branches.length; i++) {
                const branch = project.branches[i];
                const isLast = i === project.branches.length - 1;
                const branchEl = createBranchElement(branch, isLast);
                grid.appendChild(branchEl);
            }

            branchContainer.appendChild(grid);
        }
    } else {
        // Show message if no branches
        const noBranchesMsg = document.createElement('div');
        noBranchesMsg.className = 'no-branches-message';
        noBranchesMsg.style.cssText = 'padding: 8px; color: var(--color-text-secondary); font-size: 0.75rem; font-style: italic;';
        noBranchesMsg.textContent = 'No tabs in this project';
        branchContainer.appendChild(noBranchesMsg);
    }

    // ── Actions
    const actions = document.createElement('div');
    actions.className = 'project-actions';

    if (isArchived) {
        // Archived projects get Restore and Delete buttons
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'btn btn-primary';
        restoreBtn.textContent = 'Restore';
        restoreBtn.addEventListener('click', async () => {
            const allProjects = await getProjects();
            const p = allProjects.find((x) => x.id === project.id);
            if (p) {
                p.archived = false;
                p.lastAccessed = Date.now();
                await saveProjects(allProjects);
                loadData();
            }
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', async () => {
            const allProjects = await getProjects();
            const p = allProjects.find((x) => x.id === project.id);
            if (p) {
                p.dismissed = true;
                await saveProjects(allProjects);
            }
            loadData();
        });

        actions.appendChild(restoreBtn);
        actions.appendChild(deleteBtn);
    } else {
        // Active projects get Switch, Open, Delete buttons
        const switchBtn = document.createElement('button');
        switchBtn.className = 'btn btn-primary';
        switchBtn.textContent = 'Switch to project';
        switchBtn.addEventListener('click', () => {
            const allUrls = getAllProjectUrls(project);
            if (allUrls.length > 0) {
                chrome.runtime.sendMessage({ action: 'switchToProject', urls: allUrls });
                window.close();
            }
        });

        const openBtn = document.createElement('button');
        openBtn.className = 'btn btn-secondary';
        openBtn.textContent = 'Open project';
        openBtn.addEventListener('click', () => {
            const allUrls = getAllProjectUrls(project);
            if (allUrls.length > 0) {
                chrome.runtime.sendMessage({ action: 'openProjectWindow', urls: allUrls });
            }
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', async () => {
            const allProjects = await getProjects();
            const p = allProjects.find((x) => x.id === project.id);
            if (p) {
                p.dismissed = true;
                await saveProjects(allProjects);
            }
            loadData();
        });

        // Pin button
        const pinBtn = document.createElement('button');
        pinBtn.className = `btn btn-secondary project-pin ${project.pinned ? 'pinned' : ''}`;
        pinBtn.textContent = project.pinned ? '📌 Pinned' : 'Pin';
        pinBtn.title = project.pinned ? 'Unpin project (include in AI analysis)' : 'Pin project (exclude from AI analysis)';
        pinBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const allProjects = await getProjects();
            const p = allProjects.find((x) => x.id === project.id);
            if (p) {
                p.pinned = !p.pinned;
                await saveProjects(allProjects);
                project.pinned = p.pinned;
                pinBtn.textContent = p.pinned ? '📌 Pinned' : 'Pin';
                pinBtn.classList.toggle('pinned', p.pinned);
            }
        });

        // Edit name button
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-secondary';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            editProjectName(project);
        });

        actions.appendChild(switchBtn);
        actions.appendChild(openBtn);
        actions.appendChild(pinBtn);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
    }

    card.appendChild(header);
    card.appendChild(branchContainer);
    card.appendChild(actions);

    return card;
}

/**
 * Clean and decode branch domain name.
 * Removes URL encoding and makes it readable.
 */
function cleanBranchDomain(domain) {
    if (!domain) return '';
    try {
        // Decode URL encoding
        let cleaned = decodeURIComponent(domain);
        // Remove any trailing URL-encoded parts that might have been added
        // e.g., "khanacademy.org%20-%20khan%20academy" -> "khanacademy.org - khan academy"
        // But we want just the domain, so extract the domain part
        const domainMatch = cleaned.match(/^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}/);
        if (domainMatch) {
            return domainMatch[0];
        }
        // If no match, try to extract domain from the start
        const parts = cleaned.split(/[\s\-]/);
        for (const part of parts) {
            if (part.includes('.')) {
                return part;
            }
        }
        return cleaned;
    } catch {
        // If decoding fails, return original
        return domain;
    }
}

/**
 * Normalize string for comparison (lowercase, trim, remove special chars).
 */
function normalizeForComparison(str) {
    if (!str) return '';
    return str.toLowerCase().trim().replace(/[^\w.]/g, '');
}

function createBranchElement(branch, isLast) {
    const wrapper = document.createElement('div');
    wrapper.className = 'branch-item';

    const prefix = isLast ? '└' : '├';

    const treeEl = document.createElement('span');
    treeEl.className = 'branch-tree-line';
    treeEl.textContent = prefix;

    // Clean the branch domain name
    const cleanDomain = cleanBranchDomain(branch.domain);

    const nameEl = document.createElement('span');
    nameEl.className = 'branch-name';
    nameEl.textContent = cleanDomain;
    nameEl.title = `Open all ${cleanDomain} tabs`;
    nameEl.addEventListener('click', () => {
        const urls = branch.tabs.map((t) => t.url);
        if (urls.length > 0) {
            chrome.runtime.sendMessage({ action: 'openTabs', urls });
        }
    });

    wrapper.appendChild(treeEl);

    const content = document.createElement('div');
    content.className = 'branch-content';
    content.appendChild(nameEl);

    // Show individual tabs under each branch (deduplicated by title)
    if (branch.tabs && branch.tabs.length > 0) {
        const tabList = document.createElement('div');
        tabList.className = 'branch-tabs';

        // Deduplicate tabs by title, keeping only the first occurrence
        const seenTitles = new Set();
        const uniqueTabs = branch.tabs.filter((t) => {
            if (seenTitles.has(t.title)) return false;
            seenTitles.add(t.title);
            return true;
        });

        const displayTabs = uniqueTabs.slice(0, 5); // cap display
        for (let i = 0; i < displayTabs.length; i++) {
            const tab = displayTabs[i];
            const isTabLast = i === displayTabs.length - 1 && uniqueTabs.length <= 5;
            const tabEl = document.createElement('div');
            tabEl.className = 'branch-tab';
            tabEl.innerHTML = `
        <span class="branch-tab-prefix">${isTabLast ? '└' : '├'}</span>
        <a class="branch-tab-link" title="${esc(tab.title)}">${esc(tab.title)}</a>
      `;
            tabEl.querySelector('.branch-tab-link').addEventListener('click', () => {
                chrome.runtime.sendMessage({ action: 'openTabs', urls: [tab.url] });
            });
            tabList.appendChild(tabEl);
        }

        if (uniqueTabs.length > 5) {
            const more = document.createElement('div');
            more.className = 'branch-tab';
            more.innerHTML = `<span class="branch-tab-prefix">└</span><span class="branch-tab-link">+${uniqueTabs.length - 5} more</span>`;
            tabList.appendChild(more);
        }

        content.appendChild(tabList);
    }

    wrapper.appendChild(content);
    return wrapper;
}

function getAllProjectUrls(project) {
    const urls = [];
    if (project.branches) {
        for (const b of project.branches) {
            // Only take the first tab from each branch (domain)
            // This prevents opening 50+ tabs if a branch has many subpages
            if (b.tabs && b.tabs.length > 0 && b.tabs[0].url) {
                urls.push(b.tabs[0].url);
            }
        }
    }
    return urls;
}

// ── Archived projects ────────────────────────────────────────

function renderArchivedProjects(archived) {
    const section = document.getElementById('archived-section');
    const countEl = document.getElementById('archived-count');
    const list = document.getElementById('archived-list');

    if (!archived || archived.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';
    countEl.textContent = archived.length;

    // Clear and re-render
    list.innerHTML = '';
    for (const project of archived) {
        const card = createProjectCard(project, true);
        list.appendChild(card);
    }

    // Toggle expand/collapse
    const toggle = document.getElementById('archived-toggle');
    // Remove old listeners by cloning
    const newToggle = toggle.cloneNode(true);
    toggle.parentNode.replaceChild(newToggle, toggle);

    newToggle.addEventListener('click', () => {
        const isOpen = list.style.display !== 'none';
        list.style.display = isOpen ? 'none' : '';
        newToggle.querySelector('.archived-expand').textContent = isOpen ? '▶' : '▼';
    });
}

// ── Save current tabs modal ──────────────────────────────────

function setupModal() {
    const modal = document.getElementById('save-modal');
    const input = document.getElementById('project-name-input');

    document.getElementById('btn-save').addEventListener('click', () => {
        modal.classList.remove('hidden');
        input.value = '';
        input.focus();
    });

    document.getElementById('modal-cancel').addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    document.getElementById('modal-save').addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) return;

        // Get current tabs
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const filteredTabs = tabs.filter(
            (t) => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://')
        );

        if (filteredTabs.length === 0) {
            modal.classList.add('hidden');
            return;
        }

        // Group by domain
        const domainMap = {};
        for (const tab of filteredTabs) {
            let domain;
            try {
                domain = new URL(tab.url).hostname.replace(/^www\./, '');
            } catch {
                domain = 'other';
            }
            if (!domainMap[domain]) domainMap[domain] = [];
            domainMap[domain].push({ url: tab.url, title: tab.title || '' });
        }

        const branches = Object.entries(domainMap).map(([domain, tabs]) => ({
            id: generateId(),
            domain,
            tabs,
        }));

        const project = {
            id: generateId(),
            name,
            autoDetected: false,
            starred: false,
            archived: false,
            lastAccessed: Date.now(),
            branches,
            createdAt: Date.now(),
        };

        const existing = await getProjects();
        existing.unshift(project);
        await saveProjects(existing);

        modal.classList.add('hidden');
        await loadData();
    });

    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });
}

function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Manual Project Controls ──────────────────────────────────

/**
 * Edit project name inline.
 */
async function editProjectName(project) {
    const nameEl = document.querySelector(`[data-project-id="${project.id}"] .project-name`);
    if (!nameEl) return;

    const originalName = project.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'project-name-edit';
    input.value = originalName;
    input.style.cssText = `
        font-family: inherit;
        font-size: 0.95rem;
        font-weight: 600;
        border: 1px solid var(--color-accent);
        border-radius: 4px;
        padding: 2px 6px;
        width: 100%;
        outline: none;
    `;

    const saveEdit = async () => {
        const newName = input.value.trim();
        if (newName && newName !== originalName) {
            const allProjects = await getProjects();
            const p = allProjects.find((x) => x.id === project.id);
            if (p) {
                p.name = newName;
                await saveProjects(allProjects);
                loadData();
            }
        } else {
            nameEl.textContent = originalName;
        }
    };

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            nameEl.textContent = originalName;
            input.remove();
        }
    });

    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();
}

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════

async function setupSettings() {
    await loadSettings();
    await loadBlacklist();

    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-reset-settings').addEventListener('click', resetSettings);

    // Blacklist add
    const addBtn = document.getElementById('btn-add-blacklist');
    const blacklistInput = document.getElementById('blacklist-input');

    addBtn.addEventListener('click', () => addBlacklistDomain());
    blacklistInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addBlacklistDomain();
    });
}

async function loadSettings() {
    const settings = await getClusteringSettings();

    document.getElementById('setting-session-gap').value = Math.round(settings.sessionGap / 60000);
    document.getElementById('setting-data-retention').value = Math.round(settings.dataRetention / (24 * 60 * 60 * 1000));
    document.getElementById('setting-archive-threshold').value = Math.round(settings.archiveThreshold / (24 * 60 * 60 * 1000));
    document.getElementById('setting-overlap-threshold').value = Math.round(settings.overlapThreshold * 100);
    document.getElementById('setting-max-projects').value = settings.maxAutoProjects;
}

async function saveSettings() {
    const sessionGapMin = parseInt(document.getElementById('setting-session-gap').value, 10);
    const dataRetentionDays = parseInt(document.getElementById('setting-data-retention').value, 10);
    const archiveDays = parseInt(document.getElementById('setting-archive-threshold').value, 10);
    const overlapPct = parseInt(document.getElementById('setting-overlap-threshold').value, 10);
    const maxProjects = parseInt(document.getElementById('setting-max-projects').value, 10);

    if (isNaN(sessionGapMin) || isNaN(dataRetentionDays) || isNaN(archiveDays) ||
        isNaN(overlapPct) || isNaN(maxProjects)) {
        return;
    }

    await saveClusteringSettings({
        sessionGap: sessionGapMin * 60 * 1000,
        dataRetention: dataRetentionDays * 24 * 60 * 60 * 1000,
        archiveThreshold: archiveDays * 24 * 60 * 60 * 1000,
        overlapThreshold: overlapPct / 100,
        maxAutoProjects: maxProjects,
    });

    // Re-run clustering with new settings
    chrome.runtime.sendMessage({ action: 'runClustering' }, () => {
        loadData();
    });

    // Brief feedback
    const btn = document.getElementById('btn-save-settings');
    const original = btn.textContent;
    btn.textContent = 'Saved ✓';
    setTimeout(() => { btn.textContent = original; }, 1500);
}

async function resetSettings() {
    await saveClusteringSettings({
        sessionGap: TRACKING.SESSION_GAP,
        dataRetention: CLUSTERING.DATA_RETENTION,
        archiveThreshold: CLUSTERING.ARCHIVE_THRESHOLD,
        overlapThreshold: CLUSTERING.OVERLAP_THRESHOLD,
        maxAutoProjects: CLUSTERING.MAX_AUTO_PROJECTS,
    });

    await loadSettings();

    // Re-run clustering with defaults
    chrome.runtime.sendMessage({ action: 'runClustering' }, () => {
        loadData();
    });

    const btn = document.getElementById('btn-reset-settings');
    const original = btn.textContent;
    btn.textContent = 'Reset ✓';
    setTimeout(() => { btn.textContent = original; }, 1500);
}

// ── Blacklist ────────────────────────────────────────────────

async function loadBlacklist() {
    const blacklist = await getUserBlacklist();
    renderBlacklist(blacklist);
}

function renderBlacklist(blacklist) {
    const list = document.getElementById('blacklist-list');
    list.innerHTML = '';

    if (blacklist.length === 0) {
        list.innerHTML = '<div class="blacklist-empty">No domains blacklisted.</div>';
        return;
    }

    for (const domain of blacklist) {
        const item = document.createElement('div');
        item.className = 'blacklist-item';
        item.innerHTML = `
            <span class="blacklist-domain">${esc(domain)}</span>
            <button class="blacklist-remove" title="Remove from blacklist">✕</button>
        `;
        item.querySelector('.blacklist-remove').addEventListener('click', async () => {
            const current = await getUserBlacklist();
            const updated = current.filter((d) => d !== domain);
            await saveUserBlacklist(updated);
            renderBlacklist(updated);
            // Re-run clustering to update projects
            chrome.runtime.sendMessage({ action: 'runClustering' }, () => {
                loadData();
            });
        });
        list.appendChild(item);
    }
}

async function addBlacklistDomain() {
    const input = document.getElementById('blacklist-input');
    const domain = input.value.trim().toLowerCase().replace(/^www\./, '');
    if (!domain) return;

    const current = await getUserBlacklist();
    if (current.includes(domain)) {
        input.value = '';
        return;
    }

    current.push(domain);
    await saveUserBlacklist(current);
    renderBlacklist(current);
    input.value = '';

    // Re-run clustering to apply
    chrome.runtime.sendMessage({ action: 'runClustering' }, () => {
        loadData();
    });
}

// ══════════════════════════════════════════════════════════════
// DEBUG VIEW (carried over from Phase 1)
// ══════════════════════════════════════════════════════════════

function renderDomains(domains) {
    const list = document.getElementById('domain-list');
    const empty = document.getElementById('domains-empty');
    list.innerHTML = '';
    if (!domains.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    const maxCount = domains[0]?.count || 1;
    domains.forEach((d, i) => {
        const pct = Math.round((d.count / maxCount) * 100);
        const el = document.createElement('div');
        el.className = 'domain-item';
        el.innerHTML = `
      <span class="domain-rank">${i + 1}</span>
      <div class="domain-bar-wrap">
        <div class="domain-name" title="${esc(d.exampleTitle)}">${esc(d.domain)}</div>
        <div class="domain-bar" style="width: ${pct}%"></div>
      </div>
      <span class="domain-count">${d.count}</span>
    `;
        list.appendChild(el);
    });
}

function renderConnections(pairs) {
    const list = document.getElementById('connection-list');
    const empty = document.getElementById('connections-empty');
    list.innerHTML = '';
    if (!pairs.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    pairs.forEach((p) => {
        const [a, b] = p.pair.split(' ↔ ');
        const el = document.createElement('div');
        el.className = 'connection-item';
        el.innerHTML = `
      <span class="connection-pair">
        ${esc(a)}<span class="connection-arrow"> ↔ </span>${esc(b)}
      </span>
      <span class="connection-strength">${p.strength}</span>
    `;
        list.appendChild(el);
    });
}

function renderSessions(sessions) {
    const list = document.getElementById('session-list');
    const empty = document.getElementById('sessions-empty');
    list.innerHTML = '';
    if (!sessions.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    sessions.forEach((s) => {
        const el = document.createElement('div');
        el.className = 'session-item';
        const timeStr = formatTime(s.start);
        const durationStr = s.durationMin > 0 ? `${s.durationMin} min` : '< 1 min';
        const domainTags = s.domains.map((d) => `<span class="session-domain-tag">${esc(d)}</span>`).join('');
        el.innerHTML = `
      <div class="session-header">
        <span class="session-time">${timeStr}</span>
        <span class="session-duration">${durationStr}</span>
      </div>
      <div class="session-domains">${domainTags}</div>
    `;
        list.appendChild(el);
    });
}

function renderEventLog(events) {
    const list = document.getElementById('event-log');
    const empty = document.getElementById('log-empty');
    list.innerHTML = '';
    if (!events.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    events.forEach((e) => {
        const el = document.createElement('div');
        el.className = 'event-item';
        const typeClass = `event-type--${e.type}`;
        const timeStr = formatTime(e.timestamp);
        let detail = `<span class="event-domain">${esc(e.domain)}</span>`;
        if (e.title) detail += `<span class="event-title">${esc(e.title)}</span>`;
        if (e.focusDuration) {
            const sec = (e.focusDuration / 1000).toFixed(1);
            detail += `<span class="event-focus">${sec}s focused</span>`;
        }
        el.innerHTML = `
      <span class="event-type ${typeClass}">${e.type.replace('_', ' ')}</span>
      <div class="event-detail">${detail}</div>
      <span class="event-time">${timeStr}</span>
    `;
        list.appendChild(el);
    });
}

// ── Helpers ──────────────────────────────────────────────────

function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function truncate(str, maxLen = 40) {
    if (!str) return '';
    return str.length <= maxLen ? str : str.slice(0, maxLen - 1) + '…';
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Bootstrap ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
