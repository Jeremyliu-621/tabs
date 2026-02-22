/**
 * Regression tests for shared/project-utils.js
 *
 * Covers the pure functions extracted from ai-clustering.js / clustering.js:
 *   - hasProjectChanges
 *   - normalizeProjectName / nameSimilarity
 *   - getPrimaryDomain / calculateUrlOverlap
 *   - calculateJaccardSimilarity
 *   - mergeProjects
 *   - filterPinnedProjectsFromEvents
 *
 * Run:  npm test
 *       node --test tests/project-utils.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    hasProjectChanges,
    normalizeProjectName,
    nameSimilarity,
    getPrimaryDomain,
    calculateUrlOverlap,
    calculateJaccardSimilarity,
    mergeProjects,
    filterPinnedProjectsFromEvents,
} from '../shared/project-utils.js';

// ── Helpers ──────────────────────────────────────────────────

/** Minimal project factory */
function makeProject(overrides = {}) {
    return {
        id: 'p-1',
        name: 'Test Project',
        autoDetected: true,
        starred: false,
        archived: false,
        pinned: false,
        branches: [],
        ...overrides,
    };
}

function makeBranch(domain, urls = []) {
    return {
        domain,
        tabs: urls.map((url) => ({ url, title: url })),
    };
}

// ── hasProjectChanges ────────────────────────────────────────

describe('hasProjectChanges', () => {
    it('returns false for identical projects', () => {
        const projects = [makeProject({ id: 'a', name: 'Alpha' })];
        assert.equal(hasProjectChanges(projects, [...projects]), false);
    });

    it('detects different project count', () => {
        const a = [makeProject({ id: 'a' })];
        const b = [makeProject({ id: 'a' }), makeProject({ id: 'b' })];
        assert.equal(hasProjectChanges(a, b), true);
    });

    it('detects name change', () => {
        const a = [makeProject({ id: 'a', name: 'Old' })];
        const b = [makeProject({ id: 'a', name: 'New' })];
        assert.equal(hasProjectChanges(a, b), true);
    });

    it('detects starred toggle', () => {
        const a = [makeProject({ id: 'a', starred: false })];
        const b = [makeProject({ id: 'a', starred: true })];
        assert.equal(hasProjectChanges(a, b), true);
    });

    it('detects archived toggle', () => {
        const a = [makeProject({ id: 'a', archived: false })];
        const b = [makeProject({ id: 'a', archived: true })];
        assert.equal(hasProjectChanges(a, b), true);
    });

    it('detects changed branch domains', () => {
        const a = [makeProject({ id: 'a', branches: [makeBranch('x.com')] })];
        const b = [makeProject({ id: 'a', branches: [makeBranch('y.com')] })];
        assert.equal(hasProjectChanges(a, b), true);
    });

    it('detects new project ID (project swap)', () => {
        const a = [makeProject({ id: 'a' })];
        const b = [makeProject({ id: 'b' })];
        assert.equal(hasProjectChanges(a, b), true);
    });

    it('ignores timestamp-only differences', () => {
        const a = [makeProject({ id: 'a', name: 'X', lastAccessed: 100 })];
        const b = [makeProject({ id: 'a', name: 'X', lastAccessed: 999 })];
        assert.equal(hasProjectChanges(a, b), false);
    });
});

// ── normalizeProjectName ─────────────────────────────────────

describe('normalizeProjectName', () => {
    it('lowercases and trims', () => {
        assert.equal(normalizeProjectName('  My Project  '), 'my project');
    });

    it('collapses whitespace', () => {
        assert.equal(normalizeProjectName('a   b    c'), 'a b c');
    });

    it('removes special characters except hyphens', () => {
        assert.equal(normalizeProjectName('hello (world)!'), 'hello world');
    });

    it('preserves hyphens', () => {
        assert.equal(normalizeProjectName('my-project'), 'my-project');
    });

    it('returns empty string for falsy input', () => {
        assert.equal(normalizeProjectName(null), '');
        assert.equal(normalizeProjectName(''), '');
    });
});

// ── nameSimilarity ───────────────────────────────────────────

describe('nameSimilarity', () => {
    it('returns 1 for exact matches (after normalization)', () => {
        assert.equal(nameSimilarity('My Project', '  my project  '), 1.0);
    });

    it('returns high score when one name contains the other', () => {
        const score = nameSimilarity('React App', 'React');
        assert.ok(score > 0.5, `expected >0.5, got ${score}`);
    });

    it('returns score based on word overlap', () => {
        const score = nameSimilarity('AI Photo Editor', 'Photo Editor Pro');
        assert.ok(score > 0, `expected >0, got ${score}`);
    });

    it('returns 0 for completely different names', () => {
        assert.equal(nameSimilarity('Alpha', 'Beta'), 0);
    });

    it('returns 0 when one or both names are empty', () => {
        assert.equal(nameSimilarity('', 'hello'), 0);
        assert.equal(nameSimilarity('hello', ''), 0);
    });
});

// ── getPrimaryDomain ─────────────────────────────────────────

describe('getPrimaryDomain', () => {
    it('returns first branch domain', () => {
        const project = makeProject({
            branches: [makeBranch('github.com'), makeBranch('npm.com')],
        });
        assert.equal(getPrimaryDomain(project), 'github.com');
    });

    it('returns null for project with no branches', () => {
        assert.equal(getPrimaryDomain(makeProject({ branches: [] })), null);
    });

    it('returns null for project with undefined branches', () => {
        assert.equal(getPrimaryDomain(makeProject({ branches: undefined })), null);
    });
});

// ── calculateUrlOverlap ─────────────────────────────────────

describe('calculateUrlOverlap', () => {
    it('returns 1 for identical URL sets', () => {
        const urls = ['https://a.com/1', 'https://a.com/2'];
        const p1 = makeProject({ branches: [makeBranch('a.com', urls)] });
        const p2 = makeProject({ branches: [makeBranch('a.com', urls)] });
        assert.equal(calculateUrlOverlap(p1, p2), 1);
    });

    it('returns 0 for completely disjoint URL sets', () => {
        const p1 = makeProject({ branches: [makeBranch('a.com', ['https://a.com/1'])] });
        const p2 = makeProject({ branches: [makeBranch('b.com', ['https://b.com/1'])] });
        assert.equal(calculateUrlOverlap(p1, p2), 0);
    });

    it('returns partial overlap ratio', () => {
        const p1 = makeProject({ branches: [makeBranch('a.com', ['https://a.com/1', 'https://a.com/2'])] });
        const p2 = makeProject({ branches: [makeBranch('a.com', ['https://a.com/1', 'https://a.com/3'])] });
        assert.equal(calculateUrlOverlap(p1, p2), 0.5); // 1 overlap / max(2, 2)
    });

    it('returns 0 when either project has no branches/tabs', () => {
        const p1 = makeProject({ branches: [] });
        const p2 = makeProject({ branches: [makeBranch('a.com', ['https://a.com'])] });
        assert.equal(calculateUrlOverlap(p1, p2), 0);
    });
});

// ── calculateJaccardSimilarity ───────────────────────────────

describe('calculateJaccardSimilarity', () => {
    it('returns 1 for identical sets', () => {
        const s = new Set(['a', 'b', 'c']);
        assert.equal(calculateJaccardSimilarity(s, s), 1);
    });

    it('returns 1 for two empty sets', () => {
        assert.equal(calculateJaccardSimilarity(new Set(), new Set()), 1);
    });

    it('returns 0 for completely disjoint sets', () => {
        assert.equal(
            calculateJaccardSimilarity(new Set(['a', 'b']), new Set(['c', 'd'])),
            0,
        );
    });

    it('calculates correct ratio for partial overlap', () => {
        // {a,b,c} ∩ {b,c,d} = {b,c}  →  |2| / |{a,b,c,d}=4| = 0.5
        const result = calculateJaccardSimilarity(
            new Set(['a', 'b', 'c']),
            new Set(['b', 'c', 'd']),
        );
        assert.equal(result, 0.5);
    });

    it('is symmetric', () => {
        const a = new Set(['x', 'y']);
        const b = new Set(['y', 'z']);
        assert.equal(
            calculateJaccardSimilarity(a, b),
            calculateJaccardSimilarity(b, a),
        );
    });
});

// ── mergeProjects ────────────────────────────────────────────

describe('mergeProjects', () => {
    it('preserves manual projects', () => {
        const manual = makeProject({ id: 'm-1', name: 'My Manual', autoDetected: false });
        const ai = [makeProject({ id: 'ai-1', name: 'AI Project' })];
        const result = mergeProjects(ai, [manual]);

        const manualInResult = result.find((p) => p.id === 'm-1');
        assert.ok(manualInResult, 'manual project should be in merged result');
    });

    it('preserves pinned projects', () => {
        const pinned = makeProject({ id: 'pin-1', name: 'Pinned', pinned: true, autoDetected: true });
        const ai = [makeProject({ id: 'ai-1', name: 'AI Project' })];
        const result = mergeProjects(ai, [pinned]);

        const pinnedInResult = result.find((p) => p.id === 'pin-1');
        assert.ok(pinnedInResult, 'pinned project should be in merged result');
    });

    it('preserves ID when AI project matches existing by name + domain', () => {
        const existing = makeProject({
            id: 'existing-1',
            name: 'React App',
            branches: [makeBranch('github.com', ['https://github.com/repo'])],
        });
        const aiNew = makeProject({
            id: 'new-temp',
            name: 'React App',
            branches: [makeBranch('github.com', ['https://github.com/repo'])],
        });

        const result = mergeProjects([aiNew], [existing]);
        const matched = result.find((p) => p.name === 'React App');
        assert.equal(matched.id, 'existing-1', 'should preserve existing ID');
    });

    it('preserves starred status when matching', () => {
        const existing = makeProject({
            id: 'existing-1',
            name: 'Dev Project',
            starred: true,
            branches: [makeBranch('github.com', ['https://github.com/x'])],
        });
        const aiNew = makeProject({
            id: 'temp-1',
            name: 'Dev Project',
            starred: false,
            branches: [makeBranch('github.com', ['https://github.com/x'])],
        });

        const result = mergeProjects([aiNew], [existing]);
        const matched = result.find((p) => p.name === 'Dev Project');
        assert.equal(matched.starred, true, 'should preserve starred');
    });

    it('keeps new ID for unmatched AI projects', () => {
        const existing = makeProject({
            id: 'old-1',
            name: 'Totally Different',
            branches: [makeBranch('unrelated.com')],
        });
        const aiNew = makeProject({
            id: 'fresh-1',
            name: 'Brand New Project',
            branches: [makeBranch('new-domain.com')],
        });

        const result = mergeProjects([aiNew], [existing]);
        const fresh = result.find((p) => p.name === 'Brand New Project');
        assert.equal(fresh.id, 'fresh-1', 'should keep new ID');
    });

    it('does not duplicate manual projects with AI projects', () => {
        const manual = makeProject({ id: 'm-1', name: 'Manual', autoDetected: false });
        const ai = makeProject({ id: 'ai-1', name: 'Manual', autoDetected: true });

        const result = mergeProjects([ai], [manual]);
        // Manual appears once (preserved), AI also appears once (new, no match to autoDetected)
        const manualCount = result.filter((p) => p.id === 'm-1').length;
        assert.equal(manualCount, 1, 'manual should appear exactly once');
    });
});

// ── filterPinnedProjectsFromEvents ───────────────────────────

describe('filterPinnedProjectsFromEvents', () => {
    it('removes events whose URL appears in a pinned project', () => {
        const pinned = makeProject({
            pinned: true,
            branches: [makeBranch('docs.google.com', ['https://docs.google.com/d/1'])],
        });
        const events = [
            { url: 'https://docs.google.com/d/1', domain: 'docs.google.com' },
            { url: 'https://github.com/repo', domain: 'github.com' },
        ];

        const filtered = filterPinnedProjectsFromEvents(events, [pinned]);
        assert.equal(filtered.length, 1);
        assert.equal(filtered[0].domain, 'github.com');
    });

    it('keeps all events when no projects are pinned', () => {
        const unpinned = makeProject({ pinned: false });
        const events = [
            { url: 'https://a.com', domain: 'a.com' },
            { url: 'https://b.com', domain: 'b.com' },
        ];

        const filtered = filterPinnedProjectsFromEvents(events, [unpinned]);
        assert.equal(filtered.length, 2);
    });

    it('keeps events with no URL property', () => {
        const pinned = makeProject({
            pinned: true,
            branches: [makeBranch('x.com', ['https://x.com/1'])],
        });
        const events = [
            { domain: 'x.com' }, // no url prop
            { url: 'https://x.com/1', domain: 'x.com' },
        ];

        const filtered = filterPinnedProjectsFromEvents(events, [pinned]);
        assert.equal(filtered.length, 1);
        assert.equal(filtered[0].domain, 'x.com');
        assert.equal(filtered[0].url, undefined);
    });

    it('handles empty events array', () => {
        const pinned = makeProject({ pinned: true });
        assert.deepEqual(filterPinnedProjectsFromEvents([], [pinned]), []);
    });

    it('handles empty projects array', () => {
        const events = [{ url: 'https://a.com', domain: 'a.com' }];
        assert.equal(filterPinnedProjectsFromEvents(events, []).length, 1);
    });
});
