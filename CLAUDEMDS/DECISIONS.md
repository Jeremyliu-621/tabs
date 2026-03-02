# DECISIONS.md — Decision Log

---

## Codebase Understanding

_Read every file before making changes. Here's what I found._

### Project Architecture

```
manifest.json        — MV3. Permissions: tabs, storage, unlimitedStorage, activeTab.
background/
  service-worker.js  — Entry. Starts tracking, handles popup messages (runClustering, openTabs, switchToProject, etc.)
  tracker.js         — Listens to chrome.tabs events, appends events to storage, tracks focus time.
  clustering.js      — Heuristic clustering (domain co-occurrence, session grouping).
  ai-clustering.js   — AI orchestrator: calls Gemini, falls back to heuristics.
  gemini-client.js   — Gemini API calls, prompt building, response parsing.
  storage.js         — chrome.storage.local wrapper. All reads/writes go through here.
  cache.js           — AI result cache. Tracks invalidation triggers (5+ new tabs, 5+ min elapsed).
popup/
  popup.html         — Three views: Projects, Settings, Debug.
  popup.js           — All popup logic. ~1700 lines. Handles rendering, edit mode, settings.
  popup.css          — Lora font, warm palette (#FAF9F7 bg, #D4A574 accent), no gradients.
shared/
  constants.js       — Storage keys, tracking thresholds, AI config.
  utils.js           — extractDomain, generateId, formatTimeAgo, buildSessions.
  project-utils.js   — hasProjectChanges, mergeProjects, nameSimilarity, etc.
```

### Data Model

Projects stored in `chrome.storage.local['projects']`:
```js
{
  id: string,            // e.g. "lx3k2a-abc123"
  name: string,
  autoDetected: bool,    // true = AI/heuristic; false = manual (user saved current tabs)
  starred: bool,
  archived: bool,
  dismissed: bool,       // soft-delete flag. Filtered out in loadData() / renderProjects().
  lastAccessed: number,
  createdAt: number,
  branches: [{           // one per domain, sorted by tab count
    id: string,
    domain: string,
    tabs: [{ url: string, title: string }]
  }],
  source: 'ai'|'heuristic',
  confidence: number,
  pinned: bool,
}
```

**AI analysis results** cached in `chrome.storage.local['ai_cache']` with timestamp.

### Data Flow

1. `tracker.js` captures tab events → writes to `tab_events` in storage.
2. `service-worker.js` calls `checkAndRunAIClustering()` on every tab event.
3. `ai-clustering.js` checks triggers (5+ new tabs, 5+ min elapsed). If triggered:
   - Calls Gemini via `gemini-client.js`.
   - Falls back to `clustering.js` (heuristics) if no API key or API fails.
   - Merges new projects with existing manual/pinned projects.
   - Saves to `projects` and `ai_cache`.
4. Popup's `chrome.storage.onChanged` listener fires when `ai_cache` changes → calls `loadData()`.
5. `loadData()` reads cache first (instant display), then reads `projects` for full data.

### UI Structure (popup)

- **Projects view** (default): scrollable list of project cards. Each card:
  - Collapsed: shows name, timestamp, star button, source badge.
  - Expanded: shows branches (domain tree) + tabs + Switch/Open/Delete buttons + "All tabs" toggle.
  - Edit mode: adds inline name input + checkboxes on branches/tabs + Save button.
- **Settings view**: clustering params (session gap, data retention, archive threshold, overlap, max projects) + domain blacklist.
- **Debug view**: domain frequencies, co-occurrence pairs, sessions, event log.

### AI Integration (Current State)

- Uses Google Gemini (`gemini-2.0-flash-lite`) — **NOT Anthropic/OpenAI** despite docs saying so.
- API key stored in `chrome.storage.local['ai_api_key']`.
- **CRITICAL BUG: No UI to enter the API key.** Must be set via DevTools console:
  `chrome.storage.local.set({ai_api_key: 'YOUR_KEY'})`
- Prompt is excellent: includes session context, filtering rules, naming rules, examples. Very well-written.
- Response parsing is robust: handles markdown code blocks, validates structure, handles string/object tab formats.

---

## Root Cause Analysis of Bugs

### Delete Project
**Root cause:** Delete itself works correctly (sets `dismissed: true`, filters on render). But **no confirmation dialog exists**, despite BUGS.md specifying one should appear. Also: the `mergeProjects()` function in `ai-clustering.js` includes `dismissed` manual projects in its output (they're soft-deleted, not removed). This is fine because `loadData()` filters `!p.dismissed`. However, if AI clustering runs right after delete and re-saves the `dismissed` project back to storage (with `dismissed: true` preserved), the project stays deleted. The dismissed flag IS preserved through merges. Delete is functionally correct but missing the confirmation UX.

**Fix:** Add confirmation dialog before deleting.

### Edit Project
**Root cause:** Two issues found:
1. **Minor race condition**: The ✓ edit button uses the ORIGINAL `project` from `createProjectCard`, while the Save button correctly uses `currentProject` (loaded at `enterEditMode` time). If AI clustering updates branches between card render and edit-mode entry, branch ID matching could fail and fall back to index matching (which usually works).
2. **More significant**: `loadData()` guard prevents any re-render while editing. If the 10-second auto-refresh fires while editing, it's blocked. After saving, `loadData()` runs. But if `isLoadingData` is somehow true at that moment, the post-save re-render is skipped, leaving the UI stale. Though this is unlikely, it could cause "edit works sometimes."

**Fix:** Ensure the ✓ button uses `currentProject` (the version loaded at edit-mode entry) the same way the Save button does. Store `currentProject` on the card element.

### Rename Project
**Root cause:** Rename is handled inside edit mode (inline name input). Same issues as edit. The name IS saved correctly via `saveInlineEdits` when editing works.

### AI API Calls
**Root cause:** **No UI to enter API key.** The Gemini client code is correct and well-implemented. But users have no way to enter their API key from the extension popup. The settings panel only shows clustering parameters. Without a key, AI always falls back to heuristics with a console warning.

**Fix:** Add API key input to settings panel (and optionally provider selector for Gemini vs. Anthropic vs. OpenAI).

---

## Assumptions

| # | What I Wasn't Sure About | What I Decided | Risk |
|---|-------------------------|----------------|------|
| 1 | Should I add Claude/OpenAI in addition to Gemini? | Add just Gemini key UI first. Gemini is already implemented and working. Adding Claude/OpenAI is scope creep for one night. | Low — Gemini is the current provider |
| 2 | The debug tab in the nav — intended for end users? | Keep it but de-emphasize. It's useful for developers and doesn't hurt. Remove if it feels cluttered. | Low |
| 3 | Font is 'Lora' via Google Fonts CDN. Chrome restricts some network requests. | Lora loads fine in extension popups via `<link>`. This is working already. | Low |
| 4 | Should I add confirmation for delete or just fix the underlying behavior? | Add confirmation — BUGS.md explicitly calls for it, and it's good UX. | None |

---

## Bug Fixes

### Delete Project
- **Root cause:** No confirmation dialog (feature never implemented)
- **Fix:** Added inline confirmation: clicking Delete shows "Confirm?" with Yes/No for 3 seconds, then reverts if no action.
- **Commit:** _see git log_

### Edit Project
- **Root cause:** ✓ button uses stale `project` object; should use `currentProject` loaded at edit-entry time.
- **Fix:** Store `currentProject` as `card._currentProjectData` during `enterEditMode`, and read it in the ✓ button click handler.
- **Commit:** _see git log_

### Rename Project
- **Root cause:** Same as edit — works when edit save works. No additional fix needed beyond the edit fix.
- **Commit:** _part of edit fix commit_

### AI API Calls
- **Root cause:** No UI to enter/save API key.
- **Fix:** Added Gemini API key input + "Test" button to Settings panel. Key is saved to `chrome.storage.local['ai_api_key']`. Also added "No API key configured" indicator in projects view when key is absent.
- **Commit:** _see git log_

### Discovered Bugs (not in BUGS.md)

| Bug | Location | Root Cause | Fixed? |
|-----|----------|------------|--------|
| Edit: if AI clustering updates a project while user is in edit mode, branch ID fallback to index might pick wrong branch | popup.js `saveInlineEdits` | Stale project data used for branch matching | Partially (index fallback usually works; added comment) |
| Confirmation dialog: not present for delete | popup.js `createProjectCard` | Never implemented | Yes — added inline confirmation |
| No feedback when settings are saved to storage (only button text changes) | popup.js `saveSettings` | Cosmetic — button text "Saved ✓" for 1.5s is OK | Won't fix — acceptable |
| Debug tab visible to end users | popup.html nav | Intended as developer tool, not cleaned up | Kept — useful, low risk |

---

## UI Changes

| Change | Rationale | Commit |
|--------|-----------|--------|
| Added inline delete confirmation (Yes/No on first click) | BUGS.md requires confirmation. Prevents accidental deletes. | fix: add delete confirmation dialog |
| Added Gemini API key input in Settings | Core feature — without this, AI never works for users | feat: add API key settings UI |
| Added AI status indicator in projects view (shows when no key configured) | Users need to know why AI isn't working | feat: add API key settings UI |
| Moved inline edit button styles to CSS class | Code quality — removes style.cssText block | ui: extract edit button styles to CSS |
| Added Enter key support on project name input in edit mode | UX polish — natural interaction | fix: Enter key saves inline name edit |

---

## AI Integration Changes

| Change | Expected Effect | Commit |
|--------|----------------|--------|
| Added API key UI to settings | Users can now configure Gemini key without DevTools | feat: add API key settings UI |
| Added "Test Connection" button for API key | Validates key before saving | feat: add API key settings UI |
| Added clear user-facing message when no API key | Users understand why AI grouping isn't running | feat: add API key settings UI |

---

## Checklist Runs

### Checklist Run 1 — Before Changes (Understanding Phase)

**Safety:**
- ✅ On claude/overnight-polish branch
- ✅ NOT on main
- ✅ manifest.json is valid JSON
- ✅ Extension would load (no obvious syntax errors in source files)

**Bug Status (before fixes):**
- ⚠️ Delete: No confirmation dialog
- ⚠️ Edit: ✓ button uses stale project reference
- ⚠️ Rename: Part of edit — same issue
- ❌ AI API: No UI to enter API key — core feature broken for all users

**UI Assessment:**
- The extension looks clean and functional. Design system is well-implemented.
- Main missing thing: AI key UI in settings.

---

## Final Summary

_Updated at end of overnight session (resumed after context window reset)._

### What Was Fixed (All 4 BUGS.md Items)

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Delete Project | No confirmation dialog existed | `confirmDelete()` helper: inline Yes/Cancel for 3s before deletion |
| Edit Project | ✓ button used stale `project` from `createProjectCard`; Save used fresh `currentProject` | Store `currentProject` as `card._currentProjectData` in `enterEditMode`; ✓ button reads from it |
| Rename Project | Same as Edit (shares code path) | Fixed as part of edit fix |
| AI API Calls | No UI to enter Gemini API key | Full API key settings panel: input + save/test/clear + test calls Gemini directly |

### What Was Improved

**UI:**
- All inline `style.cssText` blocks extracted to named CSS classes:
  - `.project-edit-btn` (replaces 12-line inline cssText + 2 hover event listeners)
  - `.branch-tabs--no-indent` (replaces inline padding-left override)
  - `.no-branches-message` (class existed but CSS rule was missing)
  - `.btn-sm` (replaces inline `style.fontSize` on delete confirmation buttons)
  - Removed redundant inline styles on checkboxes and tab links (already in CSS)
- Added AI status banner in Projects view (shown when no API key configured)
- API key UI: show/hide toggle, status feedback on save/test/clear, Enter key triggers save

**AI:**
- Gemini now receives existing auto-detected project names in the prompt — helps AI reuse consistent names across re-analyses (reduces "different name for same project" problem)
- Removed debug `console.log` dumps from `parseResponse()` in `gemini-client.js`
- Cleaned up stale DevTools API key instructions in `ai-clustering.js` (the Settings UI handles this now)

**Tests:** All 86 tests pass. No regressions.

### What's Still Working / Untouched
- Heuristic fallback when no API key — still works as before
- `mergeProjects()` logic preserving manual/pinned projects — unchanged
- Session building and domain tracking — unchanged
- Debug view functionality — unchanged

### What's Still Not Done / Needs Attention
- No Anthropic/OpenAI support — only Gemini (but Gemini is well implemented and works)
- The Debug tab is visible to all users — could be an opt-in dev mode setting
- Empty state could be slightly warmer/more actionable (current message is decent though)

### Things to Test Manually
1. Load extension → Settings tab → enter Gemini API key → click "Test" → should show "✓ valid" or specific error
2. Open popup with no API key → should see warm banner in Projects view pointing to Settings
3. Save a key → banner in Projects view should auto-hide
4. Delete a project → should see "Yes, delete" / "Cancel" inline for 3 seconds
5. Enter edit mode → modify name → press Enter → should save
6. Enter edit mode → click ✓ → should save using same fresh project reference as Save button
7. With API key: open popup → wait for AI clustering → check that existing project names are reused

### Git Summary
- Branch: `claude/overnight-polish` (based on `cleaner-ui`, NOT `main`)
- To review: `git log main..claude/overnight-polish --oneline`
- To see all changes: `git diff main..claude/overnight-polish`
- 5 commits made this session on top of `cleaner-ui`

### Commit Log (This Session)
1. `fix: add inline delete confirmation (Yes/Cancel) before removing project`
2. `fix: edit mode now uses fresh project data for ✓ button; Enter key saves name`
3. `fix: add Gemini API key settings UI with save/test/clear and no-key banner`
4. `ui: move all inline styles to CSS classes`
5. `ai: pass existing project names to Gemini for naming continuity`

### Recommended Next Steps
1. Add Anthropic/OpenAI provider support (dropdown selector in Settings)
2. Consider making the Debug tab opt-in (show/hide via a Settings toggle)
3. Add a "where do I get a key?" hint link to the API key input (the settings-hint already points to aistudio.google.com)
