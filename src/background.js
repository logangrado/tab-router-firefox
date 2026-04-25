const MIN_MATCH_DEPTH = 1;
const NEW_WINDOW_IF_NO_MATCH = true;
const IGNORED_SCHEMES = new Set(["about", "moz-extension", "chrome", "file"]);
const RECENTLY_CLOSED_MAX = 25; // match Firefox's undo stack depth

// ─── Trie ────────────────────────────────────────────────────────────────────
//
// Each node: { _tabs: Map<tabId, windowId>, children: Map<segment, node> }
//
// A tab appears at exactly one node — the most specific prefix of its URL.
// Removal is O(depth) and precise: delete by tabId, so sibling tabs are safe.
//
// Example:
//   tab 7 → gitlab.com/org/repo-A  window 1
//   tab 8 → gitlab.com/org/repo-B  window 2
//
//   root
//   └── "gitlab.com" → { _tabs: Map(), children:
//       └── "org"    → { _tabs: Map(), children:
//           ├── "repo-A" → { _tabs: Map([[7,1]]), children: {} }
//           └── "repo-B" → { _tabs: Map([[8,2]]), children: {} }}}

const root = { _tabs: new Map(), children: new Map() };

// tabId → { url, windowId } — needed to locate the right trie node on update/remove
const tabRegistry = new Map();

function parseSegments(url) {
  try {
    const u = new URL(url);
    if (IGNORED_SCHEMES.has(u.protocol.replace(":", ""))) return null;
    return [u.hostname, ...u.pathname.split("/").filter(Boolean)];
  } catch {
    return null;
  }
}

// Returns the node for `segments`, walking from root.
// If `create=true`, missing nodes are created along the way.
// Also returns the path of [node, segment] pairs so callers can prune upward.
function getNodeWithPath(segments, create = false) {
  let node = root;
  const path = []; // [{parent, seg}] for pruning
  for (const seg of segments) {
    if (!node.children.has(seg)) {
      if (!create) return { node: null, path };
      node.children.set(seg, { _tabs: new Map(), children: new Map() });
    }
    const parent = node;
    node = node.children.get(seg);
    path.push({ parent, seg });
  }
  return { node, path };
}

function trieInsert(tabId, url, windowId) {
  const segs = parseSegments(url);
  if (!segs) return;
  const { node } = getNodeWithPath(segs, true);
  node._tabs.set(tabId, windowId);
}

function trieRemove(tabId, url) {
  const segs = parseSegments(url);
  if (!segs) return;
  const { node, path } = getNodeWithPath(segs, false);
  if (!node) return;
  node._tabs.delete(tabId);

  // Prune empty leaf nodes upward (fixes Bug 3 — memory growth)
  let current = node;
  for (let i = path.length - 1; i >= 0; i--) {
    if (current._tabs.size === 0 && current.children.size === 0) {
      path[i].parent.children.delete(path[i].seg);
      current = path[i].parent;
    } else {
      break;
    }
  }
}

/**
 * Walk the trie for `url`, returning the best { windowId, depth }.
 * Best = deepest node that has any tab NOT in excludeWindowId.
 */
function trieLookup(url, excludeWindowId) {
  const segs = parseSegments(url);
  if (!segs) return null;

  let node = root;
  let bestWindowId = null;
  let bestDepth = MIN_MATCH_DEPTH - 1;

  for (let depth = 0; depth < segs.length; depth++) {
    if (!node.children.has(segs[depth])) break;
    node = node.children.get(segs[depth]);

    if (depth >= MIN_MATCH_DEPTH) {
      for (const [, wid] of node._tabs) {
        if (wid !== excludeWindowId) {
          bestDepth = depth;
          bestWindowId = wid;
          break; // first qualifying tab at this depth is enough
        }
      }
    }
  }

  return bestWindowId !== null ? { windowId: bestWindowId, depth: bestDepth } : null;
}

// ─── Registry helpers ─────────────────────────────────────────────────────────

function registerTab(tabId, url, windowId) {
  const prev = tabRegistry.get(tabId);
  if (prev) {
    if (prev.url === url && prev.windowId === windowId) return;
    trieRemove(tabId, prev.url);
  }
  tabRegistry.set(tabId, { url, windowId });
  trieInsert(tabId, url, windowId);
}

function unregisterTab(tabId) {
  const prev = tabRegistry.get(tabId);
  if (!prev) return;
  trieRemove(tabId, prev.url);
  tabRegistry.delete(tabId);
}

async function bootstrap() {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.url) registerTab(tab.id, tab.url, tab.windowId);
  }
  console.log(`[Tab Router] Bootstrapped with ${tabRegistry.size} tabs`);
}

// ─── Routing ─────────────────────────────────────────────────────────────────

// Fix for Bug 1: only route tabs that were freshly created, not all navigations.
// onCreated fires before the URL is known, so we mark the tabId here and
// act on it in onUpdated once the URL is committed.
const pendingNewTabs = new Set();
const movingTabs = new Set();
// Recently closed tabs — for cmd-shift-T restore detection.
const recentlyClosed = [];
// Window IDs created since bootstrap — for cmd-N detection.
const newlyCreatedWindows = new Set();

// Only route tabs opened from outside Firefox. Tabs opened by clicking a link
// inside Firefox have openerTabId set; externally-opened tabs do not.
function onTabCreated(tab) {
  if (tab.openerTabId !== undefined) {
    console.log(`[Tab Router] tab ${tab.id} skipped — opened from tab ${tab.openerTabId}`);
    return;
  }
  if (tab.url === "about:newtab") {
    console.log(`[Tab Router] tab ${tab.id} skipped — Ctrl+T (about:newtab at creation)`);
    return;
  }
  // Any tab whose URL is already known at creation time is not an external app link
  // (external links always arrive with url:"" — the URL is committed asynchronously).
  if (parseSegments(tab.url)) {
    console.log(`[Tab Router] tab ${tab.id} skipped — URL set at creation (not an external link)`);
    return;
  }
  // cmd-N: the first tab in a user-created window should never be re-routed.
  // windows.onCreated typically fires before tabs.onCreated, so the window ID is
  // already in newlyCreatedWindows when we get here.
  if (newlyCreatedWindows.has(tab.windowId)) {
    newlyCreatedWindows.delete(tab.windowId);
    console.log(`[Tab Router] tab ${tab.id} skipped — first tab in user-created window`);
    return;
  }
  console.log(`[Tab Router] tab ${tab.id} pending — looks external (url="${tab.url}")`);
  pendingNewTabs.add(tab.id);
}

function onTabUpdated(tabId, changeInfo, tab) {
  if (movingTabs.has(tabId)) return;
  if (!changeInfo.url) return;

  // Always keep the trie current for all tabs
  registerTab(tabId, changeInfo.url, tab.windowId);

  // Only route if this is a freshly opened external tab
  if (!pendingNewTabs.has(tabId)) return;

  // about:newtab means the user opened this tab manually (Ctrl+T) — cancel routing.
  if (changeInfo.url === "about:newtab") {
    console.log(`[Tab Router] tab ${tabId} cancelled — navigated to about:newtab (Ctrl+T)`);
    pendingNewTabs.delete(tabId);
    return;
  }

  // Don't consume the pending entry for other unroutable URLs (e.g. about:blank
  // arrives before the real URL when opening an external link).
  // Wait for a routable URL so we route on the actual destination.
  if (!parseSegments(changeInfo.url)) {
    console.log(`[Tab Router] tab ${tabId} waiting — skipping unroutable URL: ${changeInfo.url}`);
    return;
  }

  pendingNewTabs.delete(tabId); // only route once per real URL

  // cmd-N safety net: handles the rare case where tabs.onCreated fires before
  // windows.onCreated (so the window ID wasn't in newlyCreatedWindows yet during
  // onTabCreated, but is now).
  if (newlyCreatedWindows.has(tab.windowId)) {
    newlyCreatedWindows.delete(tab.windowId);
    console.log(`[Tab Router] tab ${tabId} skipped — first tab in user-created window`);
    return;
  }

  // cmd-shift-T restore detection: if this URL was recently closed, the tab is a
  // session restore — let Firefox keep it wherever it placed it.
  const restoreIdx = recentlyClosed.lastIndexOf(changeInfo.url);
  if (restoreIdx !== -1) {
    recentlyClosed.splice(restoreIdx, 1);
    console.log(`[Tab Router] tab ${tabId} skipped — restored recently closed ${changeInfo.url}`);
    return;
  }

  const match = trieLookup(changeInfo.url, tab.windowId);
  console.log(
    `[Tab Router] tab ${tabId} routing ${changeInfo.url} — match: ${match ? `window ${match.windowId} depth ${match.depth}` : "none"}`
  );

  if (match) {
    movingTabs.add(tabId);
    browser.tabs
      .move(tabId, { windowId: match.windowId, index: -1 })
      .then(() => browser.windows.update(match.windowId, { focused: true }))
      .then(() => browser.tabs.update(tabId, { active: true }))
      .then(() => {
        registerTab(tabId, changeInfo.url, match.windowId);
        console.log(
          `[Tab Router] Routed ${changeInfo.url} → window ${match.windowId} (depth ${match.depth})`
        );
      })
      .finally(() => movingTabs.delete(tabId));
    return;
  }

  if (NEW_WINDOW_IF_NO_MATCH) {
    movingTabs.add(tabId);
    browser.windows
      .create({ tabId })
      .then((newWin) => {
        registerTab(tabId, changeInfo.url, newWin.id);
        console.log(`[Tab Router] No match for ${changeInfo.url} — new window ${newWin.id}`);
      })
      .finally(() => movingTabs.delete(tabId));
  }
}

// Only register browser listeners when running inside the extension (not in tests)
if (typeof browser !== "undefined") {
  bootstrap();

  browser.tabs.onCreated.addListener(onTabCreated);
  browser.tabs.onUpdated.addListener(onTabUpdated);

  browser.tabs.onRemoved.addListener((tabId) => {
    pendingNewTabs.delete(tabId); // clean up if tab closed before URL committed
    const prev = tabRegistry.get(tabId);
    if (prev && parseSegments(prev.url)) {
      recentlyClosed.push(prev.url);
      if (recentlyClosed.length > RECENTLY_CLOSED_MAX) recentlyClosed.shift();
    }
    unregisterTab(tabId);
  });

  // Fires when a tab is dragged from one window to another manually
  browser.tabs.onAttached.addListener((tabId, { newWindowId }) => {
    const prev = tabRegistry.get(tabId);
    if (prev) registerTab(tabId, prev.url, newWindowId);
  });

  // Track every newly created window so we can skip routing its initial tab (cmd-N).
  // browser.windows.create({ tabId }) moves an existing tab — it does not fire
  // tabs.onCreated — so newlyCreatedWindows entries are only consumed by genuine
  // new tabs (cmd-N), never by tab-router's own window creation.
  browser.windows.onCreated.addListener((window) => {
    newlyCreatedWindows.add(window.id);
  });

  browser.windows.onRemoved.addListener((windowId) => {
    newlyCreatedWindows.delete(windowId);
  });
}

// ─── Test exports ─────────────────────────────────────────────────────────────
if (typeof module !== "undefined") {
  module.exports = {
    parseSegments,
    trieInsert,
    trieRemove,
    trieLookup,
    registerTab,
    unregisterTab,
    root,
    tabRegistry,
    onTabCreated,
    onTabUpdated,
    pendingNewTabs,
    recentlyClosed,
    newlyCreatedWindows,
  };
}
