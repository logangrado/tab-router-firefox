# tab-router

A Firefox extension that automatically routes new tabs to the right window based on URL context.

When you open a link — from Slack, email, or anywhere else — tab-router finds the window where you're already working on that site and moves the tab there. If no match is found, it opens a new window instead.

## Example

You have two windows open:
- Window 1: `gitlab.com/org/repo-A`
- Window 2: `gitlab.com/org/repo-B`

A teammate sends you a link to `gitlab.com/org/repo-A/issues/42`. It lands in Window 1, not wherever your cursor happened to be.

## How matching works

New tab URLs are matched against existing tabs by progressively walking path segments, most-specific first. The window with the deepest prefix match wins.

```
gitlab.com/org/repo-A/issues/42
  └── gitlab.com          depth 0
  └── gitlab.com/org      depth 1
  └── gitlab.com/org/repo-A  depth 2 ✓ match
```

Tabs in the same window are indexed in a trie for fast lookups.

## Configuration

Three constants at the top of `src/background.js`:

| Setting | Default | Description |
|---|---|---|
| `MIN_MATCH_DEPTH` | `1` | Minimum path segments that must match to route |
| `NEW_WINDOW_IF_NO_MATCH` | `true` | Open unmatched tabs in a new window |
| `IGNORED_SCHEMES` | `about`, `moz-extension`, ... | URL schemes to never route |

## Installation

### Temporary (development)
1. Go to `about:debugging` → **This Firefox** → **Load Temporary Add-on**
2. Select `src/manifest.json`

### Permanent
```bash
npm run build   # produces tab-router.xpi
```
Open the `.xpi` in Firefox, or submit it to [addons.mozilla.org](https://addons.mozilla.org).

## Development

```bash
npm install
```

| Command | Description |
|---|---|
| `npm test` | Run the test suite |
| `npm run lint` | ESLint + web-ext extension checks |
| `npm run format` | Auto-fix formatting (Prettier) |
| `npm run format:check` | Check formatting without writing |
| `npm run build` | Package into `tab-router.xpi` |
| `npm run run` | Launch Firefox with the extension live-loaded |

## License

MIT
