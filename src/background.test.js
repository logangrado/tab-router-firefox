"use strict";

// Each describe block calls fresh() to get a clean module instance, so trie
// state never bleeds between tests.
function fresh() {
  jest.resetModules();
  return require("./background.js");
}

// ─── parseSegments ────────────────────────────────────────────────────────────

describe("parseSegments", () => {
  const { parseSegments } = fresh();

  test("returns [hostname] for a root URL", () => {
    expect(parseSegments("https://example.com")).toEqual(["example.com"]);
    expect(parseSegments("https://example.com/")).toEqual(["example.com"]);
  });

  test("returns hostname + path segments", () => {
    expect(parseSegments("https://gitlab.com/org/repo-A")).toEqual(["gitlab.com", "org", "repo-A"]);
  });

  test("strips query string and fragment", () => {
    expect(parseSegments("https://example.com/foo?bar=1&baz=2#anchor")).toEqual([
      "example.com",
      "foo",
    ]);
  });

  test("returns null for ignored schemes", () => {
    expect(parseSegments("about:blank")).toBeNull();
    expect(parseSegments("about:newtab")).toBeNull();
    expect(parseSegments("moz-extension://abc123/page.html")).toBeNull();
    expect(parseSegments("chrome://newtab/")).toBeNull();
    expect(parseSegments("file:///home/user/file.html")).toBeNull();
  });

  test("returns null for a malformed URL", () => {
    expect(parseSegments("not a url")).toBeNull();
    expect(parseSegments("")).toBeNull();
  });
});

// ─── trieInsert + trieLookup ──────────────────────────────────────────────────

describe("trieInsert + trieLookup", () => {
  test("finds a tab that was inserted", () => {
    const { trieInsert, trieLookup } = fresh();
    trieInsert(1, "https://gitlab.com/org/repo", 10);
    expect(trieLookup("https://gitlab.com/org/repo", 99)).toEqual({
      windowId: 10,
      depth: 2,
    });
  });

  test("excludeWindowId prevents self-routing", () => {
    const { trieInsert, trieLookup } = fresh();
    trieInsert(1, "https://gitlab.com/org/repo", 10);
    // Exclude the tab's own window → no match
    expect(trieLookup("https://gitlab.com/org/repo", 10)).toBeNull();
  });

  test("returns null when trie is empty", () => {
    const { trieLookup } = fresh();
    expect(trieLookup("https://gitlab.com/org/repo", 99)).toBeNull();
  });

  test("returns null when URL matches only at depth below MIN_MATCH_DEPTH", () => {
    const { trieInsert, trieLookup } = fresh();
    // MIN_MATCH_DEPTH = 1, so depth 0 (hostname only) must not match
    trieInsert(1, "https://example.com", 10);
    expect(trieLookup("https://example.com/any/path", 99)).toBeNull();
  });

  test("deeper match wins over shallower match", () => {
    const { trieInsert, trieLookup } = fresh();
    // Window 10 has a shallower match, window 20 has a deeper match
    trieInsert(1, "https://gitlab.com/org", 10);
    trieInsert(2, "https://gitlab.com/org/repo-A", 20);
    const result = trieLookup("https://gitlab.com/org/repo-A/issues/42", 99);
    // depth is 0-indexed: hostname=0, org=1, repo-A=2
    expect(result).toEqual({ windowId: 20, depth: 2 });
  });

  test("matches a URL that is deeper than any indexed tab", () => {
    const { trieInsert, trieLookup } = fresh();
    trieInsert(1, "https://gitlab.com/org/repo-A", 10);
    // The new tab's URL goes deeper — matches at depth 2 (where repo-A lives)
    expect(trieLookup("https://gitlab.com/org/repo-A/issues/42", 99)).toEqual({
      windowId: 10,
      depth: 2,
    });
  });

  test("returns null for an unrelated URL", () => {
    const { trieInsert, trieLookup } = fresh();
    trieInsert(1, "https://gitlab.com/org/repo-A", 10);
    expect(trieLookup("https://github.com/org/repo-A", 99)).toBeNull();
  });
});

// ─── trieRemove ───────────────────────────────────────────────────────────────

describe("trieRemove", () => {
  test("removed tab is no longer found", () => {
    const { trieInsert, trieRemove, trieLookup } = fresh();
    trieInsert(1, "https://gitlab.com/org/repo", 10);
    trieRemove(1, "https://gitlab.com/org/repo");
    expect(trieLookup("https://gitlab.com/org/repo", 99)).toBeNull();
  });

  test("removing one tab leaves sibling tab intact", () => {
    const { trieInsert, trieRemove, trieLookup } = fresh();
    trieInsert(1, "https://gitlab.com/org/repo-A", 10);
    trieInsert(2, "https://gitlab.com/org/repo-B", 20);
    trieRemove(1, "https://gitlab.com/org/repo-A");
    expect(trieLookup("https://gitlab.com/org/repo-B/pr/1", 99)).toEqual({
      windowId: 20,
      depth: 2,
    });
  });

  test("prunes empty nodes after removal", () => {
    const { trieInsert, trieRemove, root } = fresh();
    trieInsert(1, "https://gitlab.com/org/repo", 10);
    trieRemove(1, "https://gitlab.com/org/repo");
    // The subtree for gitlab.com should be fully pruned
    expect(root.children.size).toBe(0);
  });

  test("does not prune a node that still has tabs", () => {
    const { trieInsert, trieRemove, root } = fresh();
    trieInsert(1, "https://gitlab.com/org/repo-A", 10);
    trieInsert(2, "https://gitlab.com/org/repo-B", 20);
    trieRemove(1, "https://gitlab.com/org/repo-A");
    // root → gitlab.com → org  must still exist
    expect(root.children.has("gitlab.com")).toBe(true);
  });

  test("removing a non-existent tabId is a safe no-op", () => {
    const { trieInsert, trieRemove, trieLookup } = fresh();
    trieInsert(1, "https://gitlab.com/org/repo", 10);
    // Tab 99 was never inserted
    expect(() => trieRemove(99, "https://gitlab.com/org/repo")).not.toThrow();
    // Tab 1 is unaffected
    expect(trieLookup("https://gitlab.com/org/repo", 99)).not.toBeNull();
  });

  test("removing a tab with an unroutable URL is a no-op", () => {
    const { trieRemove } = fresh();
    expect(() => trieRemove(1, "about:blank")).not.toThrow();
    expect(() => trieRemove(1, "not a url")).not.toThrow();
  });
});

// ─── registerTab / unregisterTab ─────────────────────────────────────────────

describe("registerTab / unregisterTab", () => {
  test("registerTab populates both the registry and the trie", () => {
    const { registerTab, trieLookup, tabRegistry } = fresh();
    registerTab(1, "https://gitlab.com/org/repo", 10);
    expect(tabRegistry.get(1)).toEqual({ url: "https://gitlab.com/org/repo", windowId: 10 });
    expect(trieLookup("https://gitlab.com/org/repo", 99)).not.toBeNull();
  });

  test("re-registering with a new URL removes the old entry and adds the new one", () => {
    const { registerTab, trieLookup, tabRegistry } = fresh();
    registerTab(1, "https://gitlab.com/org/repo-A", 10);
    registerTab(1, "https://gitlab.com/org/repo-B", 10);

    expect(tabRegistry.get(1)).toEqual({
      url: "https://gitlab.com/org/repo-B",
      windowId: 10,
    });
    // Old URL must no longer match
    expect(trieLookup("https://gitlab.com/org/repo-A/issues/1", 99)).toBeNull();
    // New URL must match
    expect(trieLookup("https://gitlab.com/org/repo-B/issues/1", 99)).not.toBeNull();
  });

  test("re-registering with identical URL + windowId is a no-op (no double entry)", () => {
    const { registerTab, trieLookup, tabRegistry } = fresh();
    registerTab(1, "https://gitlab.com/org/repo", 10);
    registerTab(1, "https://gitlab.com/org/repo", 10); // exact duplicate
    // Should still only find one entry's worth of data
    expect(tabRegistry.size).toBe(1);
    expect(trieLookup("https://gitlab.com/org/repo", 99)).toEqual({
      windowId: 10,
      depth: 2,
    });
  });

  test("unregisterTab clears both the registry and the trie", () => {
    const { registerTab, unregisterTab, trieLookup, tabRegistry } = fresh();
    registerTab(1, "https://gitlab.com/org/repo", 10);
    unregisterTab(1);
    expect(tabRegistry.has(1)).toBe(false);
    expect(trieLookup("https://gitlab.com/org/repo", 99)).toBeNull();
  });

  test("unregisterTab on unknown tabId is a safe no-op", () => {
    const { unregisterTab } = fresh();
    expect(() => unregisterTab(999)).not.toThrow();
  });
});

// ─── End-to-end routing scenarios (README example) ───────────────────────────

describe("end-to-end routing", () => {
  test("routes gitlab link to the correct repo window", () => {
    const { registerTab, trieLookup } = fresh();
    // Seed two windows
    registerTab(7, "https://gitlab.com/org/repo-A", 1);
    registerTab(8, "https://gitlab.com/org/repo-B", 2);

    // Link to repo-A → Window 1 (depth 2: hostname=0, org=1, repo-A=2)
    expect(trieLookup("https://gitlab.com/org/repo-A/issues/42", 99)).toEqual({
      windowId: 1,
      depth: 2,
    });

    // Link to repo-B → Window 2
    expect(trieLookup("https://gitlab.com/org/repo-B/merge_requests/5", 99)).toEqual({
      windowId: 2,
      depth: 2,
    });
  });

  test("returns null for a URL with no matching window", () => {
    const { registerTab, trieLookup } = fresh();
    registerTab(7, "https://gitlab.com/org/repo-A", 1);
    expect(trieLookup("https://github.com/other/repo", 99)).toBeNull();
  });

  test("does not route a tab to its own window", () => {
    const { registerTab, trieLookup } = fresh();
    registerTab(7, "https://gitlab.com/org/repo-A", 1);
    // New tab opening in window 1 — should not route back to itself
    expect(trieLookup("https://gitlab.com/org/repo-A/issues/42", 1)).toBeNull();
  });

  test("multiple tabs in same window — deepest path match still wins", () => {
    const { registerTab, trieLookup } = fresh();
    registerTab(1, "https://example.com/team/project", 10);
    registerTab(2, "https://example.com/team/project/board", 20);

    const result = trieLookup("https://example.com/team/project/board/card/99", 99);
    // example.com=0, team=1, project=2, board=3
    expect(result).toEqual({ windowId: 20, depth: 3 });
  });
});

// ─── onTabUpdated: pending entry not consumed for unroutable URLs ─────────────

describe("onTabUpdated routing gate", () => {
  let mod;

  beforeEach(() => {
    mod = fresh();
    // Set global.browser AFTER fresh() so bootstrap() is not triggered,
    // but the mock is available when onTabUpdated calls browser APIs.
    global.browser = {
      tabs: { move: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
      windows: { update: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({ id: 99 }) },
    };
  });

  afterEach(() => {
    delete global.browser;
  });

  test("about:blank does not consume the pending entry", () => {
    const { onTabCreated, onTabUpdated, pendingNewTabs } = mod;
    onTabCreated({ id: 1, openerTabId: undefined, url: "" });
    onTabUpdated(1, { url: "about:blank" }, { windowId: 10 });
    // pending entry must survive so the real URL can be routed
    expect(pendingNewTabs.has(1)).toBe(true);
  });

  test("about:newtab cancels routing (Ctrl+T tab)", () => {
    const { onTabCreated, onTabUpdated, pendingNewTabs } = mod;
    onTabCreated({ id: 1, openerTabId: undefined, url: "" });
    expect(pendingNewTabs.has(1)).toBe(true); // was pending after creation
    onTabUpdated(1, { url: "about:newtab" }, { windowId: 10 });
    expect(pendingNewTabs.has(1)).toBe(false); // cancelled — user opened this tab manually
  });

  test("URL pasted into a Ctrl+T tab is not routed", () => {
    const { onTabCreated, onTabUpdated, pendingNewTabs } = mod;
    onTabCreated({ id: 1, openerTabId: undefined, url: "" });
    onTabUpdated(1, { url: "about:newtab" }, { windowId: 10 });
    onTabUpdated(1, { url: "https://github.com/firefox-devtools/debugger" }, { windowId: 10 });
    expect(pendingNewTabs.has(1)).toBe(false);
    // tab is not pending so the real URL update won't trigger routing
  });

  test("real URL consumes the pending entry", () => {
    const { onTabCreated, onTabUpdated, pendingNewTabs } = mod;
    onTabCreated({ id: 1, openerTabId: undefined, url: "" });
    onTabUpdated(1, { url: "about:blank" }, { windowId: 10 });
    onTabUpdated(1, { url: "https://github.com/firefox-devtools/debugger" }, { windowId: 10 });
    expect(pendingNewTabs.has(1)).toBe(false);
  });

  test("non-pending tab is ignored", () => {
    const { onTabUpdated, pendingNewTabs } = mod;
    onTabUpdated(99, { url: "https://github.com/firefox-devtools/debugger" }, { windowId: 10 });
    expect(pendingNewTabs.has(99)).toBe(false);
  });
});

// ─── Tab origin filtering (openerTabId) ───────────────────────────────────────

describe("tab origin filtering", () => {
  test("external tab (no openerTabId) is added to pendingNewTabs", () => {
    const { onTabCreated, pendingNewTabs } = fresh();
    onTabCreated({ id: 1, openerTabId: undefined });
    expect(pendingNewTabs.has(1)).toBe(true);
  });

  test("internal tab (openerTabId set) is NOT added to pendingNewTabs", () => {
    const { onTabCreated, pendingNewTabs } = fresh();
    onTabCreated({ id: 1, openerTabId: 5 });
    expect(pendingNewTabs.has(1)).toBe(false);
  });

  test("openerTabId = 0 is treated as internal (falsy but defined)", () => {
    const { onTabCreated, pendingNewTabs } = fresh();
    onTabCreated({ id: 1, openerTabId: 0 });
    expect(pendingNewTabs.has(1)).toBe(false);
  });

  test("multiple external tabs are all tracked", () => {
    const { onTabCreated, pendingNewTabs } = fresh();
    onTabCreated({ id: 1, openerTabId: undefined });
    onTabCreated({ id: 2, openerTabId: undefined });
    onTabCreated({ id: 3, openerTabId: 7 }); // internal — skipped
    expect(pendingNewTabs.has(1)).toBe(true);
    expect(pendingNewTabs.has(2)).toBe(true);
    expect(pendingNewTabs.has(3)).toBe(false);
  });

  test("Ctrl+T tab (url: about:newtab) is NOT added to pendingNewTabs", () => {
    const { onTabCreated, pendingNewTabs } = fresh();
    onTabCreated({ id: 1, openerTabId: undefined, url: "about:newtab" });
    expect(pendingNewTabs.has(1)).toBe(false);
  });

  test("external link (url: blank at creation) is added to pendingNewTabs", () => {
    const { onTabCreated, pendingNewTabs } = fresh();
    onTabCreated({ id: 1, openerTabId: undefined, url: "" });
    expect(pendingNewTabs.has(1)).toBe(true);
  });

  test("restored tab (url set at creation) is NOT added to pendingNewTabs", () => {
    const { onTabCreated, pendingNewTabs } = fresh();
    onTabCreated({ id: 1, openerTabId: undefined, url: "https://gitlab.com/org/repo" });
    expect(pendingNewTabs.has(1)).toBe(false);
  });
});

// ─── cmd-shift-T restore suppression ─────────────────────────────────────────

describe("cmd-shift-T restore suppression", () => {
  let mod;

  beforeEach(() => {
    mod = fresh();
    global.browser = {
      tabs: { move: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
      windows: {
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 99 }),
      },
    };
  });

  afterEach(() => {
    delete global.browser;
  });

  test("tab with URL already set at creation is not routed (parseSegments guard)", () => {
    const { onTabCreated, onTabUpdated } = mod;
    onTabCreated({ id: 5, openerTabId: undefined, url: "https://gitlab.com/org/repo", windowId: 2 });
    onTabUpdated(5, { url: "https://gitlab.com/org/repo" }, { windowId: 2 });
    expect(global.browser.tabs.move).not.toHaveBeenCalled();
    expect(global.browser.windows.create).not.toHaveBeenCalled();
  });

  test("restored tab (URL in recentlyClosed) is not routed", () => {
    const { onTabCreated, onTabUpdated, recentlyClosed } = mod;
    recentlyClosed.push("https://gitlab.com/org/repo");
    onTabCreated({ id: 5, openerTabId: undefined, url: "", windowId: 2 });
    onTabUpdated(5, { url: "https://gitlab.com/org/repo" }, { windowId: 2 });
    expect(global.browser.tabs.move).not.toHaveBeenCalled();
    expect(global.browser.windows.create).not.toHaveBeenCalled();
  });

  test("restored tab consumes its recentlyClosed entry", () => {
    const { onTabCreated, onTabUpdated, recentlyClosed } = mod;
    recentlyClosed.push("https://gitlab.com/org/repo");
    onTabCreated({ id: 5, openerTabId: undefined, url: "", windowId: 2 });
    onTabUpdated(5, { url: "https://gitlab.com/org/repo" }, { windowId: 2 });
    expect(recentlyClosed.length).toBe(0);
  });

  test("multiple successive restores each consume one entry", () => {
    const { onTabCreated, onTabUpdated, recentlyClosed } = mod;
    recentlyClosed.push("https://gitlab.com/org/repo");
    recentlyClosed.push("https://gitlab.com/org/repo");
    onTabCreated({ id: 5, openerTabId: undefined, url: "", windowId: 2 });
    onTabUpdated(5, { url: "https://gitlab.com/org/repo" }, { windowId: 2 });
    expect(recentlyClosed.length).toBe(1);
    onTabCreated({ id: 6, openerTabId: undefined, url: "", windowId: 2 });
    onTabUpdated(6, { url: "https://gitlab.com/org/repo" }, { windowId: 2 });
    expect(recentlyClosed.length).toBe(0);
    expect(global.browser.windows.create).not.toHaveBeenCalled();
  });
});
