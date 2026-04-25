# Task: fix-reopen-last-tab

**Status**: complete
**Branch**: hatchery/fix-reopen-last-tab
**Created**: 2026-04-12 20:44

## Objective

Fix two cases where tab-router routes tabs it shouldn't:
1. cmd-shift-T (session restore) — restored tab lands in a new window instead of staying put
2. cmd-N (new window) — user creates a window and types a URL before `about:newtab` commits; tab gets moved to yet another new window

## Context

tab-router marks tabs as "pending" in `onTabCreated` when they have no `openerTabId`
and a non-newtab URL, then routes them in `onTabUpdated` once a real URL commits.
This worked for external app links but misidentified two other cases:

- **cmd-shift-T:** Firefox restores the tab from session history with the URL already
  set at `onTabCreated` time. The trie has no entry for the closed tab, so
  `NEW_WINDOW_IF_NO_MATCH` fires and a spurious window is created.
- **cmd-N:** The new window's tab starts with `url: ""` (same as external links). If the
  user types before `about:newtab` commits in `onTabUpdated`, the existing cancellation
  logic misses it and the tab gets re-routed to another new window.

## Summary

Two signals were added to filter out non-external-app tab creations:

**cmd-shift-T fix** (`src/background.js:onTabCreated`):
- External app links always arrive with `tab.url === ""` — Firefox creates the tab blank
  and navigates asynchronously.
- Session-restored tabs have `tab.url` already set to the real URL at creation time.
- Added `if (parseSegments(tab.url)) return` guard: any tab with a routable URL at
  creation is skipped immediately, never entering `pendingNewTabs`.

**cmd-N fix** (`src/background.js`):
- Added `userCreatedWindowTabs: Set` tracking the initial tab ID(s) of any window
  created by the user (i.e., not by tab-router's `browser.windows.create`).
- A `browser.windows.onCreated` listener populates this set. It skips windows where any
  tab is in `movingTabs` (those were created by tab-router itself).
- Guards in both `onTabCreated` and `onTabUpdated` consume and ignore these tab IDs.
  Two guards are needed because Firefox's event ordering (`windows.onCreated` vs.
  `tabs.onCreated`) is not guaranteed; each guard handles one ordering.

**Key gotchas:**
- The `parseSegments` guard must come before the `userCreatedWindowTabs` guard in
  `onTabCreated` — ordering doesn't matter for correctness but reads more clearly.
- `userCreatedWindowTabs` entries are cleaned up in `onTabRemoved` to avoid leaks when
  a tab closes before ever navigating.
- Subsequent external links that happen to arrive in a user-created window use different
  tab IDs and are correctly routed (the set is per-tabId, not per-window).

**Files changed:**
- `src/background.js` — two new guards in `onTabCreated`, one safety-net guard in
  `onTabUpdated`, new `browser.windows.onCreated` listener, cleanup in `onTabRemoved`,
  `userCreatedWindowTabs` exported
- `src/background.test.js` — one new test in "tab origin filtering" block, new
  "cmd-N and session-restore routing suppression" describe block with 4 tests
  (43 total, all passing)
