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
import { formatTimeAgo, generateId } from '../shared/utils.js';
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

// ── Deletion queue ────────────────────────────────────────────
// Tracks project IDs being deleted so renderProjects can skip them,
// and processes deletions sequentially to avoid save-race conditions.
const pendingDeletions = new Set();
let isDeletionQueueRunning = false;
const deletionQueue = [];

/**
 * Queue a project for deletion. The card is removed from the DOM
 * immediately (optimistic update) and the storage write is serialised
 * so concurrent deletes never overwrite each other.
 */
function deleteProject(projectId) {
    if (!projectId || pendingDeletions.has(projectId)) return;

    pendingDeletions.add(projectId);

    // Optimistic UI: remove the card right away
    const card = document.querySelector(`[data-project-id="${projectId}"]`);
    if (card) card.remove();

    deletionQueue.push(projectId);
    processDeletionQueue();
}

async function processDeletionQueue() {
    if (isDeletionQueueRunning) return;
    isDeletionQueueRunning = true;

    while (deletionQueue.length > 0) {
        const id = deletionQueue.shift();
        try {
            const allProjects = await getProjects();
            const p = allProjects.find((x) => x.id === id);
            if (p) {
                p.dismissed = true;
                await saveProjects(allProjects);
            }
        } catch (err) {
            console.error('[Popup] Error deleting project:', id, err);
        }
    }

    isDeletionQueueRunning = false;
    pendingDeletions.clear();
    loadData();
}

async function loadData() {
    // Don't refresh while user is editing — it would destroy edit controls
    if (document.querySelector('.project-card.editing')) {
        return;
    }

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

    // Filter out any projects that are pending deletion (optimistic removal)
    if (pendingDeletions.size > 0) {
        projects = projects.filter((p) => !pendingDeletions.has(p.id));
    }

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
            const newCard = createProjectCard(project, false, projects.length);
            existingCard.replaceWith(newCard);
        } else {
            // Create new card and append
            const card = createProjectCard(project, false, projects.length);
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

function createProjectCard(project, isArchived = false, totalProjectCount = 1) {
    const card = document.createElement('div');
    card.className = `project-card${isArchived ? ' project-card--archived' : ''}`;
    card.dataset.projectId = project.id;
    // Store project data for editing
    card._projectData = project;

    // ── Header row
    const header = document.createElement('div');
    header.className = 'project-header';
    
    // Source badge
    const sourceBadge = project.source === 'ai' 
        ? '<span class="source-badge source-badge--ai" title="AI Enhanced">✨</span>'
        : project.autoDetected 
            ? '<span class="source-badge source-badge--heuristic" title="Auto">Auto</span>'
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
    
    // Add edit button next to project name (only for non-archived projects)
    if (!isArchived) {
        const nameEl = header.querySelector('.project-name');
        const editBtn = document.createElement('button');
        editBtn.className = 'project-edit-btn';
        editBtn.textContent = '✎';
        editBtn.title = 'Edit project name';
        editBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--color-text-secondary, #666);
            cursor: pointer;
            font-size: 0.9rem;
            padding: 2px 4px;
            margin-left: 4px;
            opacity: 0.6;
            transition: opacity 0.2s;
        `;
        editBtn.addEventListener('mouseenter', () => {
            editBtn.style.opacity = '1';
        });
        editBtn.addEventListener('mouseleave', () => {
            editBtn.style.opacity = '0.6';
        });
        editBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            toggleEditMode(card, project);
        });
        nameEl.parentNode.insertBefore(editBtn, nameEl.nextSibling);
    }

    // Restore expanded state from localStorage
    const expandedIds = JSON.parse(localStorage.getItem('tabs_expanded_projects') || '[]');
    if (expandedIds.includes(project.id)) {
        card.classList.add('expanded');
    }

    header.addEventListener('click', (e) => {
        // Always ignore these elements
        if (e.target.closest('.project-star')) return;
        if (e.target.closest('.project-name-edit')) return;
        if (e.target.closest('.project-edit-btn')) return;
        if (e.target.closest('.project-name-edit-inline')) return;
        if (e.target.closest('.project-meta')) return;
        
        // In edit mode, only allow toggling when clicking the expand arrow
        const isEditing = card.classList.contains('editing');
        if (isEditing) {
            // Check if click is directly on the expand arrow
            const expandArrow = header.querySelector('.project-expand');
            if (e.target !== expandArrow && !expandArrow.contains(e.target)) {
                return; // Only allow toggling via the arrow in edit mode
            }
        }
        
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
            // If there's only one project, allow tabs to use multiple columns
            if (totalProjectCount === 1) {
                tabList.classList.add('branch-tabs--multi-column');
            }

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
                const branchEl = createBranchElement(branch, isLast, totalProjectCount);
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
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteProject(project.id);
        });

        actions.appendChild(restoreBtn);
        actions.appendChild(deleteBtn);
    } else {
        // Active projects: Clean button layout with toggle for sub-branches
        const actionsLeft = document.createElement('div');
        actionsLeft.className = 'project-actions-left';
        
        const actionsRight = document.createElement('div');
        actionsRight.className = 'project-actions-right';
        
        // Toggle for including sub-branches
        const includeSubBranchesToggle = document.createElement('label');
        includeSubBranchesToggle.className = 'include-sub-branches-toggle';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'sub-branches-checkbox';
        const label = document.createElement('span');
        label.className = 'toggle-label';
        label.textContent = 'All tabs';
        includeSubBranchesToggle.appendChild(checkbox);
        includeSubBranchesToggle.appendChild(label);
        includeSubBranchesToggle.title = 'Include sub-branches (all tabs)';
        
        // Update toggle styling when checked
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                includeSubBranchesToggle.classList.add('checked');
            } else {
                includeSubBranchesToggle.classList.remove('checked');
            }
        });
        
        // Switch button
        const switchBtn = document.createElement('button');
        switchBtn.className = 'btn btn-primary';
        switchBtn.textContent = 'Switch';
        switchBtn.addEventListener('click', () => {
            const allUrls = checkbox.checked 
                ? getAllProjectUrlsWithSubBranches(project)
                : getAllProjectUrls(project);
            if (allUrls.length > 0) {
                chrome.runtime.sendMessage({ action: 'switchToProject', urls: allUrls });
                window.close();
            }
        });

        // Open button
        const openBtn = document.createElement('button');
        openBtn.className = 'btn btn-primary';
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', () => {
            const allUrls = checkbox.checked 
                ? getAllProjectUrlsWithSubBranches(project)
                : getAllProjectUrls(project);
            if (allUrls.length > 0) {
                chrome.runtime.sendMessage({ action: 'openProjectWindow', urls: allUrls });
            }
        });

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteProject(project.id);
        });

        actionsLeft.appendChild(includeSubBranchesToggle);
        actionsLeft.appendChild(switchBtn);
        actionsLeft.appendChild(openBtn);
        actionsRight.appendChild(deleteBtn);
        
        actions.appendChild(actionsLeft);
        actions.appendChild(actionsRight);
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

function createBranchElement(branch, isLast, totalProjectCount = 1) {
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
        // If there's only one project, allow tabs to use multiple columns
        if (totalProjectCount === 1) {
            tabList.classList.add('branch-tabs--multi-column');
        }

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

function getAllProjectUrlsWithSubBranches(project) {
    const urls = [];
    if (project.branches) {
        for (const b of project.branches) {
            // Get ALL tabs from each branch (including sub-branches)
            if (b.tabs && b.tabs.length > 0) {
                for (const tab of b.tabs) {
                    if (tab.url) {
                        urls.push(tab.url);
                    }
                }
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

// ── Manual Project Controls ──────────────────────────────────

/**
 * Toggle edit mode for a project card.
 */
async function toggleEditMode(card, project) {
    const isEditing = card.classList.contains('editing');
    
    // Prevent multiple rapid clicks
    if (card._isEnteringEditMode) {
        return;
    }
    
    if (isEditing) {
        // Exit edit mode and save
        await exitEditMode(card, project);
    } else {
        // Enter edit mode
        card._isEnteringEditMode = true;
        await enterEditMode(card, project);
        card._isEnteringEditMode = false;
    }
}

/**
 * Exit edit mode and save changes.
 */
async function exitEditMode(card, project) {
    // Get project ID from card if project parameter is not available
    const projectId = project?.id || card.dataset.projectId;
    if (!projectId) {
        console.error('[Popup] Cannot exit edit mode: no project ID');
        return;
    }
    
    // Get fresh project data if not provided
    let projectData = project;
    if (!projectData || !projectData.branches) {
        const allProjects = await getProjects();
        projectData = allProjects.find((x) => x.id === projectId) || card._projectData;
    }
    
    if (!projectData) {
        console.error('[Popup] Cannot exit edit mode: project data not found');
        return;
    }
    
    // Save the edits first
    try {
        await saveInlineEdits(card, projectData);
    } catch (err) {
        console.error('[Popup] Error saving edits:', err);
        // Still exit edit mode even if save fails
    }
    
    // Remove editing class before re-rendering
    card.classList.remove('editing');
    
    // Force re-render by clearing the hash for this project
    renderedProjects.delete(projectId);
    
    // Re-render the card to show normal view (this will replace the card)
    await loadData();
}

/**
 * Enter edit mode for a project card.
 */
async function enterEditMode(card, project) {
    // Prevent entering edit mode if already editing
    if (card.classList.contains('editing')) {
        return;
    }
    
    card.classList.add('editing');
    
    // Load fresh project data
    const allProjects = await getProjects();
    const currentProject = allProjects.find((x) => x.id === project.id);
    if (!currentProject) {
        console.error('[Popup] Project not found for editing:', project.id);
        card.classList.remove('editing');
        return;
    }

    // Make project name editable
    const nameEl = card.querySelector('.project-name');
    if (nameEl && !nameEl.querySelector('input')) {
        const originalName = currentProject.name;
    const input = document.createElement('input');
    input.type = 'text';
        input.className = 'project-name-edit-inline';
    input.value = originalName;
    input.style.cssText = `
        font-family: inherit;
        font-size: 0.95rem;
        font-weight: 600;
        border: 1px solid var(--color-accent);
        border-radius: 4px;
        padding: 2px 6px;
        width: 100%;
            max-width: 300px;
        outline: none;
            background: var(--color-surface);
        `;
        nameEl.textContent = '';
        nameEl.appendChild(input);
        input.focus();
        input.select();
    }

    // Add checkboxes to branches and tabs
    const branchContainer = card.querySelector('.project-branches');
    if (branchContainer) {
        addEditControlsToBranches(branchContainer, currentProject);
    }

    // Update edit button text
    const editBtn = card.querySelector('.project-edit-btn');
    if (editBtn) {
        editBtn.textContent = '✓';
        editBtn.title = 'Done editing';
    }

    // Replace all action buttons with just Save
    const actions = card.querySelector('.project-actions');
    if (actions) {
        // Hide all existing buttons
        const existingButtons = actions.querySelectorAll('.btn:not(.btn-save-inline)');
        existingButtons.forEach(btn => {
            btn.style.display = 'none';
            btn.dataset.wasVisible = 'true';
        });
        
        // Add or show save button
        let saveBtn = actions.querySelector('.btn-save-inline');
        if (!saveBtn) {
            saveBtn = document.createElement('button');
            saveBtn.className = 'btn btn-primary btn-save-inline';
            saveBtn.textContent = 'Save';
            saveBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('[Popup] Save button clicked for project:', currentProject.id);
                try {
                    await exitEditMode(card, currentProject);
                    console.log('[Popup] Save completed successfully');
                } catch (err) {
                    console.error('[Popup] Error in save button handler:', err);
                    // Still try to exit edit mode
                    card.classList.remove('editing');
                    renderedProjects.delete(currentProject.id);
                    await loadData();
                }
            });
            actions.appendChild(saveBtn);
        } else {
            saveBtn.style.display = '';
        }
    }
}

/**
 * Add edit controls (checkboxes) to branches and tabs.
 */
function addEditControlsToBranches(branchContainer, project) {
    // Remove any existing edit checkboxes first to prevent duplicates
    branchContainer.querySelectorAll('.branch-edit-checkbox, .tab-edit-checkbox').forEach(cb => cb.remove());
    
    // Check if we have the normal branch structure or the skipped branch display.
    // Use :scope > .branch-tabs to find a tab list that is a direct child of
    // branchContainer (the "skipped branch" layout). In normal branch display,
    // .branch-tabs elements are nested inside .branch-item > .branch-content.
    const branchItems = branchContainer.querySelectorAll('.branch-item');
    const directTabList = branchContainer.querySelector(':scope > .branch-tabs');
    
    if (branchItems.length > 0) {
        // Normal branch structure
        branchItems.forEach((branchItem, index) => {
            const branch = project.branches[index];
            if (!branch) return;

            // Add checkbox to branch name
            const branchNameEl = branchItem.querySelector('.branch-name');
            if (branchNameEl) {
                // Get the original text - extract only text nodes, ignoring checkboxes
                const textNodes = Array.from(branchNameEl.childNodes)
                    .filter(node => node.nodeType === Node.TEXT_NODE)
                    .map(node => node.textContent)
                    .join('')
                    .trim();
                
                // Fallback: if no text nodes, try to get textContent and clean it
                const originalText = textNodes || branchNameEl.textContent.trim();
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'branch-edit-checkbox';
                checkbox.checked = true;
                checkbox.dataset.branchId = branch.id || branch.domain;
                checkbox.style.cssText = 'margin-right: 6px; cursor: pointer;';
                
                // Stop checkbox clicks from propagating to branch name
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
                
                // Override the branch name click handler to only toggle checkbox in edit mode
                // Remove the original click listener by cloning and replacing
                const newBranchName = branchNameEl.cloneNode(false);
                newBranchName.className = branchNameEl.className;
                newBranchName.title = branchNameEl.title;
                
                // Add checkbox and text to the new element
                newBranchName.appendChild(checkbox);
                newBranchName.appendChild(document.createTextNode(originalText));
                
                branchNameEl.parentNode.replaceChild(newBranchName, branchNameEl);
                
                // Add new click handler that only toggles checkbox (doesn't open website)
                newBranchName.style.cursor = 'pointer';
                newBranchName.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (e.target !== checkbox) {
                        checkbox.checked = !checkbox.checked;
                        checkbox.dispatchEvent(new Event('change'));
                    }
                });

                // When branch checkbox changes, enable/disable tab checkboxes
                checkbox.addEventListener('change', () => {
                    const tabCheckboxes = branchItem.querySelectorAll('.tab-edit-checkbox');
                    tabCheckboxes.forEach((cb) => {
                        cb.disabled = !checkbox.checked;
                    });
                });
            }

        // Add checkboxes to tabs
        const tabLinks = branchItem.querySelectorAll('.branch-tab-link');
        
        // Create a map of tab titles to actual tabs (matching the deduplication logic)
        const tabMap = new Map();
        branch.tabs.forEach(tab => {
            if (!tabMap.has(tab.title)) {
                tabMap.set(tab.title, tab);
            }
        });
        
        tabLinks.forEach((tabLink) => {
            if (tabLink.textContent.startsWith('+')) return; // Skip "more" indicator
            
            // Find the tab by matching title
            const tabTitle = tabLink.textContent.trim();
            const tab = tabMap.get(tabTitle);
            if (!tab) return;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'tab-edit-checkbox';
            checkbox.checked = true;
            checkbox.dataset.tabUrl = tab.url;
            checkbox.style.cssText = 'margin-right: 4px; cursor: pointer;';
            
            // Insert checkbox before tab link
            const tabItem = tabLink.closest('.branch-tab');
            if (tabItem) {
                tabItem.insertBefore(checkbox, tabLink);
                
                // Make tab clickable to toggle checkbox
                tabLink.style.cursor = 'pointer';
                tabLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (e.target !== checkbox) {
                        checkbox.checked = !checkbox.checked;
                    }
                });
            }
        });
        });
    } else if (directTabList && project.branches && project.branches.length === 1) {
        // Skipped branch display - single branch with tabs shown directly
        const branch = project.branches[0];
        const tabLinks = directTabList.querySelectorAll('.branch-tab-link');
        
        // Create a map of displayed tab titles to actual tabs
        const tabMap = new Map();
        branch.tabs.forEach(tab => {
            if (!tabMap.has(tab.title)) {
                tabMap.set(tab.title, tab);
            }
        });
        
        tabLinks.forEach((tabLink) => {
            if (tabLink.textContent.startsWith('+')) return; // Skip "more" indicator
            
            // Find the tab by matching title
            const tabTitle = tabLink.textContent.trim();
            const tab = tabMap.get(tabTitle);
            if (!tab) return;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'tab-edit-checkbox';
            checkbox.checked = true;
            checkbox.dataset.tabUrl = tab.url;
            checkbox.style.cssText = 'margin-right: 4px; cursor: pointer;';
            
            // Insert checkbox before tab link
            const tabItem = tabLink.closest('.branch-tab');
            if (tabItem) {
                tabItem.insertBefore(checkbox, tabLink);
                
                // Make tab clickable to toggle checkbox
                tabLink.style.cursor = 'pointer';
                tabLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (e.target !== checkbox) {
                        checkbox.checked = !checkbox.checked;
                    }
                });
            }
        });
    }
}

/**
 * Save inline edits.
 */
async function saveInlineEdits(card, project) {
    if (!project || !project.id) {
        console.error('[Popup] Invalid project data for saving:', project);
        return;
    }
    
            const allProjects = await getProjects();
            const p = allProjects.find((x) => x.id === project.id);
    if (!p) {
        console.error('[Popup] Project not found for saving:', project.id);
        return;
    }

    // Get edited project name
    const nameInput = card.querySelector('.project-name-edit-inline');
    if (nameInput && nameInput.value.trim()) {
        p.name = nameInput.value.trim();
    }

    // Collect selected branches and tabs
    const branchContainer = card.querySelector('.project-branches');
    if (!branchContainer) {
        console.warn('[Popup] No branch container found, saving name only');
                await saveProjects(allProjects);
        return;
    }

    const branchItems = branchContainer.querySelectorAll('.branch-item');
    const directTabList = branchContainer.querySelector(':scope > .branch-tabs');
    const newBranches = [];

    if (branchItems.length > 0) {
        // Normal branch structure
        branchItems.forEach((branchItem, index) => {
            // Try multiple ways to find the checkbox
            let branchCheckbox = branchItem.querySelector('.branch-edit-checkbox');
            if (!branchCheckbox) {
                // Fallback: search in branch-name element
                const branchName = branchItem.querySelector('.branch-name');
                if (branchName) {
                    branchCheckbox = branchName.querySelector('.branch-edit-checkbox');
                }
            }
            
            if (!branchCheckbox) {
                console.warn('[Popup] No branch checkbox found for branch item:', index);
                return;
            }
            
            if (!branchCheckbox.checked) {
                return; // Skip unchecked branches
            }

            const branchId = branchCheckbox.dataset.branchId;
            if (!branchId) {
                console.warn('[Popup] Branch checkbox missing branchId:', branchCheckbox);
                return;
            }
            
            let originalBranch = project.branches.find(
                (b) => (b.id && b.id === branchId) || b.domain === branchId
            );
            
            // Fallback: try matching by index if ID matching fails
            if (!originalBranch && index < project.branches.length) {
                originalBranch = project.branches[index];
                console.warn('[Popup] Branch ID match failed, using index fallback:', index);
            }
            
            if (!originalBranch) {
                console.warn('[Popup] Original branch not found for ID:', branchId, 'or index:', index, 'Available branches:', project.branches.map(b => b.id || b.domain));
                return;
            }

            // Collect selected tabs
            const tabCheckboxes = branchItem.querySelectorAll('.tab-edit-checkbox:checked');
            const selectedTabs = [];
            
            tabCheckboxes.forEach((tabCheckbox) => {
                const tabUrl = tabCheckbox.dataset.tabUrl;
                const originalTab = originalBranch.tabs.find((t) => t.url === tabUrl);
                if (originalTab) {
                    selectedTabs.push(originalTab);
                }
            });

            // Only include branch if it has at least one tab
            if (selectedTabs.length > 0) {
                newBranches.push({
                    ...originalBranch,
                    tabs: selectedTabs,
                });
            }
        });
    } else if (directTabList && project.branches && project.branches.length === 1) {
        // Skipped branch display - single branch with tabs shown directly
        const branch = project.branches[0];
        const tabCheckboxes = directTabList.querySelectorAll('.tab-edit-checkbox:checked');
        const selectedTabs = [];
        
        tabCheckboxes.forEach((tabCheckbox) => {
            const tabUrl = tabCheckbox.dataset.tabUrl;
            const originalTab = branch.tabs.find((t) => t.url === tabUrl);
            if (originalTab) {
                selectedTabs.push(originalTab);
            }
        });

        // Only include branch if it has at least one tab
        if (selectedTabs.length > 0) {
            newBranches.push({
                ...branch,
                tabs: selectedTabs,
            });
        }
    }

    // Update project branches
    p.branches = newBranches;

    // Save changes
    try {
        await saveProjects(allProjects);
        console.log('[Popup] Successfully saved project edits:', p.id, 'Branches:', newBranches.length);
    } catch (err) {
        console.error('[Popup] Error saving projects:', err);
        throw err; // Re-throw so caller can handle it
    }
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

function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Bootstrap ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
