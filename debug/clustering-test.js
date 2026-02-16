/**
 * Clustering Test Page — Main Logic
 *
 * Loads scenarios, injects events into chrome.storage.local,
 * triggers clustering via message to service worker, and
 * renders results for manual evaluation.
 *
 * Also includes the custom scenario builder for creating
 * ad-hoc test scenarios with custom URLs, timing, and sessions.
 */

import { ALL_SCENARIOS } from './scenarios.js';
import { STORAGE_KEYS, TRACKING, CLUSTERING } from '../shared/constants.js';

// ── Constants ────────────────────────────────────────────────

const DEFAULTS = {
    sessionGap: TRACKING.SESSION_GAP,
    dataRetention: CLUSTERING.DATA_RETENTION,
    archiveThreshold: CLUSTERING.ARCHIVE_THRESHOLD,
    overlapThreshold: CLUSTERING.OVERLAP_THRESHOLD,
    minClusterSize: CLUSTERING.MIN_CLUSTER_SIZE,
    maxAutoProjects: CLUSTERING.MAX_AUTO_PROJECTS,
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CUSTOM_SCENARIOS_KEY = 'custom_scenarios';

// ── DOM References ───────────────────────────────────────────

const $scenarioGrid = document.getElementById('scenario-grid');
const $btnClear = document.getElementById('btn-clear');
const $scenarioInfo = document.getElementById('scenario-info');
const $scenarioName = document.getElementById('scenario-name');
const $scenarioDesc = document.getElementById('scenario-description');
const $detailSimulates = document.getElementById('detail-simulates');
const $detailEvents = document.getElementById('detail-events');
const $detailTimespan = document.getElementById('detail-timespan');
const $btnRun = document.getElementById('btn-run');
const $loadingState = document.getElementById('loading-state');
const $resultsSection = document.getElementById('results-section');
const $resultsList = document.getElementById('results-list');
const $statProjects = document.getElementById('stat-projects');
const $statTabs = document.getElementById('stat-tabs');
const $statShared = document.getElementById('stat-shared');
const $statArchived = document.getElementById('stat-archived');
const $evalGood = document.getElementById('eval-good');
const $evalBad = document.getElementById('eval-bad');
const $evalNotes = document.getElementById('eval-notes');
const $notesTextarea = document.getElementById('notes-textarea');

// Settings DOM
const $settingsToggle = document.getElementById('settings-toggle');
const $settingsToggleIcon = document.getElementById('settings-toggle-icon');
const $settingsBody = document.getElementById('settings-body');
const $settingSessionGap = document.getElementById('setting-session-gap');
const $settingDataRetention = document.getElementById('setting-data-retention');
const $settingArchiveThreshold = document.getElementById('setting-archive-threshold');
const $settingOverlapThreshold = document.getElementById('setting-overlap-threshold');
const $settingMinCluster = document.getElementById('setting-min-cluster');
const $settingMaxProjects = document.getElementById('setting-max-projects');
const $btnSettingsSave = document.getElementById('btn-settings-save');
const $btnSettingsReset = document.getElementById('btn-settings-reset');
const $settingsStatus = document.getElementById('settings-status');

// Builder DOM
const $builderToggle = document.getElementById('builder-toggle');
const $builderToggleIcon = document.getElementById('builder-toggle-icon');
const $builderBody = document.getElementById('builder-body');
const $builderName = document.getElementById('builder-name');
const $builderDesc = document.getElementById('builder-desc');
const $builderSessions = document.getElementById('builder-sessions');
const $builderAddSession = document.getElementById('builder-add-session');
const $builderRun = document.getElementById('builder-run');
const $builderSave = document.getElementById('builder-save');
const $builderClear = document.getElementById('builder-clear');
const $builderSavedList = document.getElementById('builder-saved-list');
const $builderStatus = document.getElementById('builder-status');

// ── State ────────────────────────────────────────────────────

let currentScenario = null;
let currentScenarioData = null;

// ── Utilities ────────────────────────────────────────────────

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function flashStatus(el, message, type = 'success') {
    el.textContent = message;
    el.className = `settings-status ${type}`;
    show(el);
    setTimeout(() => hide(el), 2500);
}

function extractDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

// ── Collapsible Toggle Helper ────────────────────────────────

function setupToggle(toggleBtn, iconEl, bodyEl) {
    toggleBtn.addEventListener('click', () => {
        bodyEl.classList.toggle('hidden');
        iconEl.classList.toggle('expanded');
        if (bodyEl.classList.contains('hidden')) {
            toggleBtn.style.borderRadius = '';
        } else {
            toggleBtn.style.borderRadius = 'var(--radius-md) var(--radius-md) 0 0';
        }
    });
}

setupToggle($settingsToggle, $settingsToggleIcon, $settingsBody);
setupToggle($builderToggle, $builderToggleIcon, $builderBody);

// ── Settings Logic ───────────────────────────────────────────

async function loadSettingsIntoUI() {
    const saved = (await chrome.storage.local.get(STORAGE_KEYS.CLUSTERING_SETTINGS))[STORAGE_KEYS.CLUSTERING_SETTINGS] || {};

    const settings = {
        sessionGap: saved.sessionGap ?? DEFAULTS.sessionGap,
        dataRetention: saved.dataRetention ?? DEFAULTS.dataRetention,
        archiveThreshold: saved.archiveThreshold ?? DEFAULTS.archiveThreshold,
        overlapThreshold: saved.overlapThreshold ?? DEFAULTS.overlapThreshold,
        minClusterSize: saved.minClusterSize ?? DEFAULTS.minClusterSize,
        maxAutoProjects: saved.maxAutoProjects ?? DEFAULTS.maxAutoProjects,
    };

    $settingSessionGap.value = Math.round(settings.sessionGap / MINUTE);
    $settingDataRetention.value = Math.round(settings.dataRetention / DAY);
    $settingArchiveThreshold.value = Math.round(settings.archiveThreshold / DAY);
    $settingOverlapThreshold.value = Math.round(settings.overlapThreshold * 100);
    $settingMinCluster.value = settings.minClusterSize;
    $settingMaxProjects.value = settings.maxAutoProjects;
}

async function saveSettings() {
    const settings = {
        sessionGap: parseInt($settingSessionGap.value) * MINUTE,
        dataRetention: parseInt($settingDataRetention.value) * DAY,
        archiveThreshold: parseInt($settingArchiveThreshold.value) * DAY,
        overlapThreshold: parseInt($settingOverlapThreshold.value) / 100,
        minClusterSize: parseInt($settingMinCluster.value),
        maxAutoProjects: parseInt($settingMaxProjects.value),
    };

    await chrome.storage.local.set({ [STORAGE_KEYS.CLUSTERING_SETTINGS]: settings });
    console.log('Settings saved:', settings);
    flashStatus($settingsStatus, '✓ Settings saved', 'success');
}

async function resetSettings() {
    await chrome.storage.local.remove(STORAGE_KEYS.CLUSTERING_SETTINGS);
    await loadSettingsIntoUI();
    console.log('Settings reset to defaults');
    flashStatus($settingsStatus, '↩ Reset to defaults', 'info');
}

$btnSettingsSave.addEventListener('click', saveSettings);
$btnSettingsReset.addEventListener('click', resetSettings);

// ═══════════════════════════════════════════════════════════════
// ── Custom Scenario Builder ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════

let builderSessionCounter = 0;

function createSessionGroup(gapMinutes = 0) {
    builderSessionCounter++;
    const sessionNum = builderSessionCounter;

    const container = document.createElement('div');
    container.className = 'builder-session';
    container.dataset.sessionId = sessionNum;

    // Header
    const header = document.createElement('div');
    header.className = 'builder-session-header';

    const title = document.createElement('span');
    title.className = 'builder-session-title';
    title.textContent = `Session ${sessionNum}`;

    const controls = document.createElement('div');
    controls.className = 'builder-session-controls';

    // Gap before this session
    const gapControl = document.createElement('div');
    gapControl.className = 'builder-gap-control';
    gapControl.innerHTML = `
        Gap before:
        <input type="number" class="builder-gap-input" value="${gapMinutes}" min="0" max="10080" placeholder="0" />
        <span>min</span>
    `;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'builder-delete-session';
    deleteBtn.textContent = '✕ Remove';
    deleteBtn.addEventListener('click', () => container.remove());

    controls.appendChild(gapControl);
    controls.appendChild(deleteBtn);
    header.appendChild(title);
    header.appendChild(controls);
    container.appendChild(header);

    // Column labels
    const labels = document.createElement('div');
    labels.className = 'builder-tab-labels';
    labels.innerHTML = `
        <span>URL</span>
        <span>Title (optional)</span>
        <span>Delay</span>
        <span></span>
    `;
    container.appendChild(labels);

    // Tab list
    const tabList = document.createElement('div');
    tabList.className = 'builder-tabs';
    container.appendChild(tabList);

    // Add initial empty tab
    tabList.appendChild(createTabRow());

    // Add tab button
    const addTabBtn = document.createElement('button');
    addTabBtn.className = 'builder-add-tab';
    addTabBtn.textContent = '+ Add Tab';
    addTabBtn.addEventListener('click', () => {
        tabList.appendChild(createTabRow());
    });
    container.appendChild(addTabBtn);

    return container;
}

function createTabRow(url = '', title = '', delaySec = 5) {
    const row = document.createElement('div');
    row.className = 'builder-tab-row';

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'builder-tab-url';
    urlInput.placeholder = 'https://example.com/page';
    urlInput.value = url;

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'builder-tab-title';
    titleInput.placeholder = 'Page Title';
    titleInput.value = title;

    const delayInput = document.createElement('input');
    delayInput.type = 'number';
    delayInput.className = 'builder-tab-delay';
    delayInput.min = '0';
    delayInput.max = '3600';
    delayInput.value = delaySec;
    delayInput.title = 'Seconds after previous tab';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'builder-tab-delete';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', () => row.remove());

    row.appendChild(urlInput);
    row.appendChild(titleInput);
    row.appendChild(delayInput);
    row.appendChild(deleteBtn);
    return row;
}

function readBuilderState() {
    const name = $builderName.value.trim() || 'Custom Scenario';
    const description = $builderDesc.value.trim() || '';

    const sessions = [];
    for (const sessionEl of $builderSessions.children) {
        const gapInput = sessionEl.querySelector('.builder-gap-input');
        const gapMinutes = parseInt(gapInput?.value) || 0;

        const tabs = [];
        for (const row of sessionEl.querySelectorAll('.builder-tab-row')) {
            const url = row.querySelector('.builder-tab-url').value.trim();
            const title = row.querySelector('.builder-tab-title').value.trim();
            const delaySec = parseInt(row.querySelector('.builder-tab-delay').value) || 0;

            if (url) {
                tabs.push({ url, title, delaySec });
            }
        }

        if (tabs.length > 0) {
            sessions.push({ gapMinutes, tabs });
        }
    }

    return { name, description, sessions };
}

function generateEventsFromBuilder(state) {
    const events = [];
    let cursor = Date.now();

    // Walk backwards: total time = sum of all gaps + all delays
    // So we start from (now - totalTime) and walk forward
    let totalMs = 0;
    for (const session of state.sessions) {
        totalMs += session.gapMinutes * MINUTE;
        for (const tab of session.tabs) {
            totalMs += tab.delaySec * 1000;
        }
    }

    cursor = Date.now() - totalMs;

    for (const session of state.sessions) {
        cursor += session.gapMinutes * MINUTE;

        for (const tab of session.tabs) {
            cursor += tab.delaySec * 1000;
            const domain = extractDomain(tab.url);
            events.push({
                url: tab.url,
                domain,
                title: tab.title || tab.url,
                timestamp: cursor,
                type: 'activated',
            });
        }
    }

    return events;
}

function loadBuilderState(state) {
    $builderName.value = state.name || '';
    $builderDesc.value = state.description || '';
    $builderSessions.innerHTML = '';
    builderSessionCounter = 0;

    for (const session of state.sessions) {
        const group = createSessionGroup(session.gapMinutes);
        const tabList = group.querySelector('.builder-tabs');
        tabList.innerHTML = ''; // Remove the default empty tab

        for (const tab of session.tabs) {
            tabList.appendChild(createTabRow(tab.url, tab.title, tab.delaySec));
        }

        $builderSessions.appendChild(group);
    }
}

// ── Builder Actions ──────────────────────────────────────────

$builderAddSession.addEventListener('click', () => {
    const isFirst = $builderSessions.children.length === 0;
    $builderSessions.appendChild(createSessionGroup(isFirst ? 0 : 30));
});

$builderRun.addEventListener('click', async () => {
    const state = readBuilderState();

    if (state.sessions.length === 0) {
        flashStatus($builderStatus, '⚠ Add at least one session with tabs', 'info');
        return;
    }

    const events = generateEventsFromBuilder(state);

    // Inject events
    await chrome.storage.local.set({
        [STORAGE_KEYS.TAB_EVENTS]: events,
        [STORAGE_KEYS.PROJECTS]: [],
    });

    // Deselect any preset scenario
    document.querySelectorAll('.scenario-btn').forEach((b) => b.classList.remove('active'));

    // Populate scenario info
    currentScenario = { id: 'custom', label: state.name };
    currentScenarioData = {
        name: state.name,
        description: state.description,
        simulates: `${state.sessions.length} session${state.sessions.length !== 1 ? 's' : ''}, custom URLs`,
        events,
        timespan: state.sessions.length > 0
            ? `${state.sessions.reduce((s, sess) => s + sess.gapMinutes, 0)} min total gaps`
            : 'N/A',
    };

    $scenarioName.textContent = currentScenarioData.name;
    $scenarioDesc.textContent = currentScenarioData.description;
    $detailSimulates.textContent = currentScenarioData.simulates;
    $detailEvents.textContent = `${events.length} tab events`;
    $detailTimespan.textContent = currentScenarioData.timespan;

    show($scenarioInfo);
    hide($resultsSection);
    hide($loadingState);

    console.log(`Custom scenario loaded: ${events.length} events`);
    flashStatus($builderStatus, `✓ Loaded ${events.length} events — click Run Clustering above`, 'success');
});

$builderSave.addEventListener('click', () => {
    const state = readBuilderState();

    if (state.sessions.length === 0) {
        flashStatus($builderStatus, '⚠ Nothing to save', 'info');
        return;
    }

    const saved = JSON.parse(localStorage.getItem(CUSTOM_SCENARIOS_KEY) || '[]');
    // Replace if same name exists
    const idx = saved.findIndex((s) => s.name === state.name);
    if (idx >= 0) {
        saved[idx] = state;
    } else {
        saved.push(state);
    }
    localStorage.setItem(CUSTOM_SCENARIOS_KEY, JSON.stringify(saved));

    renderSavedScenarios();
    flashStatus($builderStatus, `✓ Saved "${state.name}"`, 'success');
});

$builderClear.addEventListener('click', () => {
    $builderName.value = '';
    $builderDesc.value = '';
    $builderSessions.innerHTML = '';
    builderSessionCounter = 0;
    flashStatus($builderStatus, '🗑 Builder cleared', 'info');
});

// ── Saved Scenarios ──────────────────────────────────────────

function renderSavedScenarios() {
    $builderSavedList.innerHTML = '';

    const saved = JSON.parse(localStorage.getItem(CUSTOM_SCENARIOS_KEY) || '[]');

    if (saved.length === 0) {
        $builderSavedList.innerHTML = '<span class="builder-empty">No saved scenarios yet</span>';
        return;
    }

    for (const scenario of saved) {
        const chip = document.createElement('div');
        chip.className = 'saved-chip';

        const loadBtn = document.createElement('button');
        loadBtn.className = 'saved-chip-load';
        loadBtn.textContent = scenario.name;
        loadBtn.addEventListener('click', () => {
            loadBuilderState(scenario);
            flashStatus($builderStatus, `✓ Loaded "${scenario.name}"`, 'success');
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'saved-chip-delete';
        deleteBtn.textContent = '✕';
        deleteBtn.addEventListener('click', () => {
            const list = JSON.parse(localStorage.getItem(CUSTOM_SCENARIOS_KEY) || '[]');
            const updated = list.filter((s) => s.name !== scenario.name);
            localStorage.setItem(CUSTOM_SCENARIOS_KEY, JSON.stringify(updated));
            renderSavedScenarios();
        });

        chip.appendChild(loadBtn);
        chip.appendChild(deleteBtn);
        $builderSavedList.appendChild(chip);
    }
}

// ═══════════════════════════════════════════════════════════════
// ── Preset Scenario Buttons ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════

function renderScenarioButtons() {
    for (const scenario of ALL_SCENARIOS) {
        const btn = document.createElement('button');
        btn.className = 'scenario-btn';
        btn.dataset.id = scenario.id;
        btn.innerHTML = `<span class="scenario-emoji">${scenario.emoji}</span>${scenario.label}`;
        btn.addEventListener('click', () => onScenarioClick(scenario));
        $scenarioGrid.appendChild(btn);
    }
}

// ── Event Handlers ───────────────────────────────────────────

async function onScenarioClick(scenario) {
    document.querySelectorAll('.scenario-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.id === scenario.id)
    );

    currentScenario = scenario;
    currentScenarioData = scenario.generate();

    await chrome.storage.local.set({
        [STORAGE_KEYS.TAB_EVENTS]: currentScenarioData.events,
        [STORAGE_KEYS.PROJECTS]: [],
    });

    console.log(`Loaded scenario: ${currentScenarioData.name}`);
    console.log(`Injected ${currentScenarioData.events.length} events`);

    $scenarioName.textContent = currentScenarioData.name;
    $scenarioDesc.textContent = currentScenarioData.description;
    $detailSimulates.textContent = currentScenarioData.simulates;
    $detailEvents.textContent = `${currentScenarioData.events.length} tab events`;
    $detailTimespan.textContent = currentScenarioData.timespan;

    show($scenarioInfo);
    hide($resultsSection);
    hide($loadingState);

    $evalGood.classList.remove('active');
    $evalBad.classList.remove('active');
    $evalNotes.classList.remove('active');
    hide($notesTextarea);
}

async function onRunClustering() {
    show($loadingState);
    hide($resultsSection);

    await new Promise((r) => setTimeout(r, 500));

    try {
        const response = await chrome.runtime.sendMessage({ action: 'runClustering' });

        hide($loadingState);

        if (!response || !response.success) {
            const errorMsg = response?.error || 'Unknown error';
            alert(`Clustering failed: ${errorMsg}`);
            console.error('Clustering failed:', errorMsg);
            return;
        }

        const projects = response.projects || [];
        console.log('Clustering complete:', projects);

        renderResults(projects);
        show($resultsSection);
    } catch (err) {
        hide($loadingState);
        alert(`Clustering failed: ${err.message}`);
        console.error('Clustering error:', err);
    }
}

async function onClearAll() {
    await chrome.storage.local.set({
        [STORAGE_KEYS.TAB_EVENTS]: [],
        [STORAGE_KEYS.PROJECTS]: [],
    });

    currentScenario = null;
    currentScenarioData = null;

    hide($scenarioInfo);
    hide($loadingState);
    hide($resultsSection);

    document.querySelectorAll('.scenario-btn').forEach((b) =>
        b.classList.remove('active')
    );

    console.log('Cleared all data');
}

// ── Render Results ───────────────────────────────────────────

function renderResults(projects) {
    $resultsList.innerHTML = '';

    const displayProjects = projects.filter((p) => !p.dismissed);

    if (displayProjects.length === 0) {
        $resultsList.innerHTML = '<div class="no-projects">No projects detected</div>';
        updateStats(displayProjects);
        return;
    }

    displayProjects.forEach((project, index) => {
        const card = createProjectCard(project, index + 1);
        $resultsList.appendChild(card);
    });

    updateStats(displayProjects);
}

function createProjectCard(project, number) {
    const card = document.createElement('div');
    card.className = `result-card${project.archived ? ' archived' : ''}`;

    const header = document.createElement('div');
    header.className = 'result-card-header';

    const title = document.createElement('span');
    title.className = 'result-card-title';
    title.textContent = `Project ${number}: ${project.name}`;
    header.appendChild(title);

    if (project.archived) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-archived';
        badge.textContent = 'Archived';
        header.appendChild(badge);
    }

    if (project.starred) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-starred';
        badge.textContent = '⭐';
        header.appendChild(badge);
    }

    card.appendChild(header);

    const branches = project.branches || [];
    const totalTabs = branches.reduce((sum, b) => sum + (b.tabs?.length || 0), 0);

    const meta = document.createElement('div');
    meta.className = 'result-meta';
    meta.innerHTML = `
        <span class="meta-item"><span class="meta-icon">🌐</span> ${branches.length} domain${branches.length !== 1 ? 's' : ''}</span>
        <span class="meta-item"><span class="meta-icon">📄</span> ${totalTabs} tab${totalTabs !== 1 ? 's' : ''}</span>
        <span class="meta-item"><span class="meta-icon">🕐</span> ${project.lastAccessed ? formatTimeAgo(project.lastAccessed) : 'unknown'}</span>
    `;
    card.appendChild(meta);

    const branchesContainer = document.createElement('div');
    branchesContainer.className = 'result-branches';

    for (const branch of branches) {
        const branchEl = document.createElement('div');
        branchEl.className = 'result-branch';

        const branchHeader = document.createElement('div');
        branchHeader.className = 'branch-header';
        branchHeader.innerHTML = `
            <span class="branch-domain">${branch.domain}</span>
            <span class="branch-count">${branch.tabs?.length || 0} tab${(branch.tabs?.length || 0) !== 1 ? 's' : ''}</span>
        `;
        branchEl.appendChild(branchHeader);

        const tabsList = document.createElement('ul');
        tabsList.className = 'branch-tabs-list';

        const tabs = branch.tabs || [];
        const displayTabs = tabs.slice(0, 5);

        for (const tab of displayTabs) {
            const li = document.createElement('li');
            li.className = 'branch-tab-item';
            li.textContent = tab.title || tab.url;
            tabsList.appendChild(li);
        }

        branchEl.appendChild(tabsList);

        if (tabs.length > 5) {
            const more = document.createElement('div');
            more.className = 'branch-more';
            more.textContent = `+ ${tabs.length - 5} more`;
            branchEl.appendChild(more);
        }

        branchesContainer.appendChild(branchEl);
    }

    card.appendChild(branchesContainer);
    return card;
}

function updateStats(projects) {
    $statProjects.textContent = projects.length;

    const totalTabs = projects.reduce((sum, p) =>
        sum + (p.branches || []).reduce((s, b) => s + (b.tabs?.length || 0), 0), 0
    );
    $statTabs.textContent = totalTabs;

    const domainProjectCount = {};
    for (const p of projects) {
        for (const b of p.branches || []) {
            domainProjectCount[b.domain] = (domainProjectCount[b.domain] || 0) + 1;
        }
    }
    const shared = Object.values(domainProjectCount).filter((c) => c >= 2).length;
    $statShared.textContent = shared;

    const archived = projects.filter((p) => p.archived).length;
    $statArchived.textContent = archived;
}

// ── Evaluation ───────────────────────────────────────────────

$evalGood.addEventListener('click', () => {
    $evalGood.classList.add('active');
    $evalBad.classList.remove('active');
    console.log('User evaluation: good');
    saveEvaluation('good');
});

$evalBad.addEventListener('click', () => {
    $evalBad.classList.add('active');
    $evalGood.classList.remove('active');
    console.log('User evaluation: bad');
    saveEvaluation('bad');
});

$evalNotes.addEventListener('click', () => {
    $evalNotes.classList.toggle('active');
    $notesTextarea.classList.toggle('hidden');
    if (!$notesTextarea.classList.contains('hidden')) {
        $notesTextarea.focus();
    }
});

function saveEvaluation(rating) {
    const key = `clustering_eval_${currentScenario?.id || 'unknown'}`;
    const entry = {
        scenario: currentScenario?.id,
        rating,
        notes: $notesTextarea.value || '',
        timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(entry));
}

// ── Wire Up ──────────────────────────────────────────────────

$btnRun.addEventListener('click', onRunClustering);
$btnClear.addEventListener('click', onClearAll);

renderScenarioButtons();
loadSettingsIntoUI();
renderSavedScenarios();
