# Task: tabrouter

**Status**: complete
**Branch**: (none — no-worktree mode)
**Created**: 2026-03-31 08:07

## Objective

I am working on creating the firefox extension here.

Please read and understand what it does, and help me to take it across the finish line.

## Context

Tab Router is a Firefox extension that routes newly opened tabs to the correct window
based on URL prefix matching. When you open a link (e.g. from Slack or email), the
extension finds the window where you're already working on that site and moves the tab
there instead of landing it wherever your cursor happened to be.

The core logic uses a trie data structure keyed on URL segments (hostname + path), with
deepest-match-wins semantics. Three configurable constants control behavior:
- `MIN_MATCH_DEPTH` (default 1): minimum path segments required to trigger routing
- `NEW_WINDOW_IF_NO_MATCH` (default true): open unmatched tabs in a new window
- `IGNORED_SCHEMES`: URL schemes never routed

The logic was already complete and correct when this task started. The only gap was
build infrastructure: the README promised `npm run build → tab-router.xpi` and files
in `src/`, but neither existed.

## Summary

### What was done

1. **Moved sources into `src/`** — `manifest.json` and `background.js` now live in
   `src/` so the README's temp-install instruction (`about:debugging → src/manifest.json`)
   works as written.

2. **Added `package.json`** with Mozilla's official [`web-ext`](https://github.com/mozilla/web-ext)
   as a dev dependency. Three scripts:
   - `npm run build` — produces `tab-router-1.0.xpi` in the project root
   - `npm run lint`  — validates the extension against Firefox compatibility rules
   - `npm run run`   — launches Firefox with the extension loaded for development

3. **Updated `.gitignore`** — added `node_modules/`, `web-ext-artifacts/`, and `*.xpi`

### Key decisions

- **`web-ext` over a custom zip script**: Mozilla's official tool handles manifest
  validation, file exclusions (node_modules, .git, etc.), and produces a correctly
  structured archive. No custom logic needed.
- **`--artifacts-dir .`**: Puts the `.xpi` in the project root rather than the default
  `web-ext-artifacts/` subfolder, matching the README's implied output location.
- **No code changes**: The routing logic, trie implementation, and bug fixes in
  `background.js` were already correct and needed no modification.

### To build and install

```bash
npm install
npm run build   # → tab-router-1.0.xpi
```

Load the `.xpi` in Firefox via `about:addons`, or submit to addons.mozilla.org.
For development: `npm run run` launches Firefox with the extension live-loaded.

### Gotchas for future agents

- The extension uses Manifest V2 (not V3). Firefox still supports MV2; this is intentional.
- `NEW_WINDOW_IF_NO_MATCH = true` means every unmatched new tab spawns a new window —
  aggressive but configurable at the top of `src/background.js`.
- The trie is keyed on `hostname + pathSegments`; query strings and fragments are ignored,
  which is correct for matching "context" rather than exact URLs.
- The sandbox container used to build this task does not have Node.js installed, so
  `npm install` / `npm run build` were not verified in CI — they should be run on a
  machine with Node.js to confirm.
