/**
 * Unit tests for shared/utils.js
 *
 * Run:  npm test            (all tests)
 *       node --test tests/utils.test.js   (this file only)
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
    extractDomain,
    shouldIgnoreUrl,
    generateId,
    formatTimeAgo,
    truncate,
    getTabDisplayName,
    buildSessions,
} from '../shared/utils.js';

// ── extractDomain ────────────────────────────────────────────

describe('extractDomain', () => {
    it('returns hostname without www prefix', () => {
        assert.equal(extractDomain('https://www.example.com/page'), 'example.com');
    });

    it('returns hostname for non-www URLs', () => {
        assert.equal(extractDomain('https://docs.google.com/spreadsheets'), 'docs.google.com');
    });

    it('handles http:// URLs', () => {
        assert.equal(extractDomain('http://localhost:3000/api'), 'localhost');
    });

    it('handles URLs with paths and queries', () => {
        assert.equal(extractDomain('https://github.com/user/repo?tab=code#readme'), 'github.com');
    });

    it('returns null for chrome:// URLs', () => {
        assert.equal(extractDomain('chrome://extensions/'), null);
    });

    it('returns null for chrome-extension:// URLs', () => {
        assert.equal(extractDomain('chrome-extension://abc123/popup.html'), null);
    });

    it('returns null for about: URLs', () => {
        assert.equal(extractDomain('about:blank'), null);
    });

    it('returns null for edge:// URLs', () => {
        assert.equal(extractDomain('edge://settings'), null);
    });

    it('returns null for brave:// URLs', () => {
        assert.equal(extractDomain('brave://settings'), null);
    });

    it('returns null for empty string', () => {
        assert.equal(extractDomain(''), null);
    });

    it('returns null for null/undefined', () => {
        assert.equal(extractDomain(null), null);
        assert.equal(extractDomain(undefined), null);
    });

    it('returns null for invalid URLs', () => {
        assert.equal(extractDomain('not a url'), null);
    });
});

// ── shouldIgnoreUrl ──────────────────────────────────────────

describe('shouldIgnoreUrl', () => {
    it('ignores chrome:// URLs', () => {
        assert.equal(shouldIgnoreUrl('chrome://newtab'), true);
    });

    it('ignores chrome-extension:// URLs', () => {
        assert.equal(shouldIgnoreUrl('chrome-extension://abc/popup.html'), true);
    });

    it('ignores about: URLs', () => {
        assert.equal(shouldIgnoreUrl('about:blank'), true);
    });

    it('ignores edge:// URLs', () => {
        assert.equal(shouldIgnoreUrl('edge://settings'), true);
    });

    it('ignores brave:// URLs', () => {
        assert.equal(shouldIgnoreUrl('brave://wallet'), true);
    });

    it('does not ignore regular http URLs', () => {
        assert.equal(shouldIgnoreUrl('https://example.com'), false);
    });

    it('does not ignore localhost', () => {
        assert.equal(shouldIgnoreUrl('http://localhost:3000'), false);
    });

    it('returns true for null/undefined/empty', () => {
        assert.equal(shouldIgnoreUrl(null), true);
        assert.equal(shouldIgnoreUrl(undefined), true);
        assert.equal(shouldIgnoreUrl(''), true);
    });
});

// ── generateId ───────────────────────────────────────────────

describe('generateId', () => {
    it('returns a non-empty string', () => {
        const id = generateId();
        assert.equal(typeof id, 'string');
        assert.ok(id.length > 0);
    });

    it('contains a hyphen separator', () => {
        assert.ok(generateId().includes('-'));
    });

    it('generates unique IDs on consecutive calls', () => {
        const ids = new Set(Array.from({ length: 50 }, () => generateId()));
        assert.equal(ids.size, 50);
    });
});

// ── formatTimeAgo ────────────────────────────────────────────

describe('formatTimeAgo', () => {
    it('returns empty string for falsy timestamp', () => {
        assert.equal(formatTimeAgo(0), '');
        assert.equal(formatTimeAgo(null), '');
        assert.equal(formatTimeAgo(undefined), '');
    });

    it('returns "just now" for <60 seconds ago', () => {
        assert.equal(formatTimeAgo(Date.now() - 30_000), 'just now');
    });

    it('returns minutes for 1–59 min ago', () => {
        assert.equal(formatTimeAgo(Date.now() - 5 * 60_000), '5 min ago');
        assert.equal(formatTimeAgo(Date.now() - 1 * 60_000), '1 min ago');
    });

    it('returns hours (singular/plural) for 1–23h ago', () => {
        assert.equal(formatTimeAgo(Date.now() - 1 * 3_600_000), '1 hour ago');
        assert.equal(formatTimeAgo(Date.now() - 3 * 3_600_000), '3 hours ago');
    });

    it('returns days (singular/plural) for 1–6d ago', () => {
        assert.equal(formatTimeAgo(Date.now() - 1 * 86_400_000), '1 day ago');
        assert.equal(formatTimeAgo(Date.now() - 5 * 86_400_000), '5 days ago');
    });

    it('returns weeks for ≥7 days ago', () => {
        assert.equal(formatTimeAgo(Date.now() - 7 * 86_400_000), '1 week ago');
        assert.equal(formatTimeAgo(Date.now() - 21 * 86_400_000), '3 weeks ago');
    });
});

// ── truncate ─────────────────────────────────────────────────

describe('truncate', () => {
    it('returns string unchanged if within limit', () => {
        assert.equal(truncate('hello', 10), 'hello');
    });

    it('truncates and adds ellipsis when over limit', () => {
        const result = truncate('hello world, this is a very long string', 10);
        assert.equal(result, 'hello wor…');
        assert.equal(result.length, 10);
    });

    it('uses default maxLen of 40', () => {
        const long = 'a'.repeat(50);
        const result = truncate(long);
        assert.equal(result.length, 40);
        assert.ok(result.endsWith('…'));
    });

    it('returns empty string for falsy input', () => {
        assert.equal(truncate(''), '');
        assert.equal(truncate(null), '');
        assert.equal(truncate(undefined), '');
    });

    it('returns string unchanged at exact limit', () => {
        const exact = 'a'.repeat(40);
        assert.equal(truncate(exact), exact);
    });
});

// ── getTabDisplayName ────────────────────────────────────────

describe('getTabDisplayName', () => {
    it('returns truncated title when available', () => {
        assert.equal(
            getTabDisplayName({ title: 'My Page', url: 'https://example.com' }),
            'My Page',
        );
    });

    it('falls back to domain when title is empty', () => {
        assert.equal(
            getTabDisplayName({ title: '', url: 'https://example.com/path' }),
            'example.com',
        );
    });

    it('falls back to domain when title is whitespace', () => {
        assert.equal(
            getTabDisplayName({ title: '   ', url: 'https://docs.google.com' }),
            'docs.google.com',
        );
    });

    it('returns "Untitled" when both title and domain are unavailable', () => {
        assert.equal(
            getTabDisplayName({ title: '', url: 'chrome://newtab' }),
            'Untitled',
        );
    });
});

// ── buildSessions ────────────────────────────────────────────

describe('buildSessions', () => {
    const BASE = 1_700_000_000_000; // fixed base timestamp
    const GAP = 15 * 60 * 1000; // 15-minute default gap

    function makeEvent(domain, offsetMs) {
        return { domain, timestamp: BASE + offsetMs, url: `https://${domain}/` };
    }

    it('returns empty array for no events', () => {
        assert.deepEqual(buildSessions([]), []);
    });

    it('groups events within gap into one session', () => {
        const events = [
            makeEvent('a.com', 0),
            makeEvent('b.com', 60_000),       // +1 min
            makeEvent('c.com', 120_000),      // +2 min
        ];
        const sessions = buildSessions(events, GAP);
        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].events.length, 3);
        assert.deepEqual([...sessions[0].domains].sort(), ['a.com', 'b.com', 'c.com']);
    });

    it('splits into two sessions when gap exceeded', () => {
        const events = [
            makeEvent('a.com', 0),
            makeEvent('b.com', 60_000),                // same session
            makeEvent('c.com', 60_000 + GAP + 1),      // new session
        ];
        const sessions = buildSessions(events, GAP);
        assert.equal(sessions.length, 2);
        assert.equal(sessions[0].events.length, 2);
        assert.equal(sessions[1].events.length, 1);
    });

    it('sorts events chronologically regardless of input order', () => {
        const events = [
            makeEvent('c.com', 200_000),
            makeEvent('a.com', 0),
            makeEvent('b.com', 100_000),
        ];
        const sessions = buildSessions(events, GAP);
        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].events[0].domain, 'a.com');
        assert.equal(sessions[0].events[2].domain, 'c.com');
    });

    it('filters out events with missing domain or timestamp', () => {
        const events = [
            makeEvent('a.com', 0),
            { domain: null, timestamp: BASE + 1000, url: 'https://x.com' },
            { domain: 'b.com', timestamp: null, url: 'https://b.com' },
        ];
        const sessions = buildSessions(events, GAP);
        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].events.length, 1);
    });

    it('assigns stable session IDs based on start timestamp', () => {
        const events = [makeEvent('a.com', 0), makeEvent('b.com', 60_000)];
        const sessions = buildSessions(events, GAP);
        assert.equal(sessions[0].id, `session_${BASE}`);
    });

    it('tracks start/end timestamps correctly', () => {
        const events = [
            makeEvent('a.com', 0),
            makeEvent('b.com', 300_000), // +5 min
        ];
        const sessions = buildSessions(events, GAP);
        assert.equal(sessions[0].start, BASE);
        assert.equal(sessions[0].end, BASE + 300_000);
    });
});
