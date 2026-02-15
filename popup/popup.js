/**
 * Tabs Popup — Debug Dashboard
 *
 * Shows live tracking stats, domain frequencies, co-occurrence
 * connections, browsing sessions, and a raw event log.
 */

import { getStats, getDebugAnalytics } from '../background/storage.js';

// ── Init ─────────────────────────────────────────────────────

async function init() {
    setupTabs();
    document.getElementById('btn-refresh').addEventListener('click', loadData);
    await loadData();
}

async function loadData() {
    try {
        const [stats, analytics] = await Promise.all([getStats(), getDebugAnalytics()]);
        renderStats(stats, analytics);
        renderDomains(analytics.domainFrequency);
        renderConnections(analytics.coOccurrencePairs);
        renderSessions(analytics.sessions);
        renderEventLog(analytics.recentEvents);
    } catch (err) {
        console.error('[Tabs] Popup error:', err);
    }
}

// ── Tab switching ────────────────────────────────────────────

function setupTabs() {
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

// ── Render functions ─────────────────────────────────────────

function renderStats(stats, analytics) {
    document.getElementById('stat-events').textContent = stats.totalEvents.toLocaleString();
    document.getElementById('stat-domains').textContent = stats.uniqueDomains.toLocaleString();
    document.getElementById('stat-sessions').textContent = analytics.sessions.length.toLocaleString();
}

function renderDomains(domains) {
    const list = document.getElementById('domain-list');
    const empty = document.getElementById('domains-empty');
    list.innerHTML = '';

    if (!domains.length) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    const maxCount = domains[0]?.count || 1;

    domains.forEach((d, i) => {
        const pct = Math.round((d.count / maxCount) * 100);
        const el = document.createElement('div');
        el.className = 'domain-item';
        el.innerHTML = `
      <span class="domain-rank">${i + 1}</span>
      <div class="domain-bar-wrap">
        <div class="domain-name" title="${escapeHtml(d.exampleTitle)}">${escapeHtml(d.domain)}</div>
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

    if (!pairs.length) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    pairs.forEach((p) => {
        const [a, b] = p.pair.split(' ↔ ');
        const el = document.createElement('div');
        el.className = 'connection-item';
        el.innerHTML = `
      <span class="connection-pair">
        ${escapeHtml(a)}<span class="connection-arrow"> ↔ </span>${escapeHtml(b)}
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

    if (!sessions.length) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    sessions.forEach((s) => {
        const el = document.createElement('div');
        el.className = 'session-item';

        const timeStr = formatTime(s.start);
        const durationStr = s.durationMin > 0 ? `${s.durationMin} min` : '< 1 min';
        const domainTags = s.domains
            .map((d) => `<span class="session-domain-tag">${escapeHtml(d)}</span>`)
            .join('');

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

    if (!events.length) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    events.forEach((e) => {
        const el = document.createElement('div');
        el.className = 'event-item';

        const typeClass = `event-type--${e.type}`;
        const timeStr = formatTime(e.timestamp);

        let detail = `<span class="event-domain">${escapeHtml(e.domain)}</span>`;
        if (e.title) {
            detail += `<span class="event-title">${escapeHtml(e.title)}</span>`;
        }
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
    const isToday =
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();

    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isToday) return time;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Bootstrap ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
