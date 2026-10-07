import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ stored: {} as Record<string, unknown> }));
vi.mock("../src/main/db.js", () => ({
  kvGet: () => state.stored,
  kvSet: (_key: string, value: unknown) => (state.stored = value as Record<string, unknown>),
}));

const { getSettings, updateSettings } = await import("../src/main/settings.js");
const { layerOf } = await import("../src/shared/settings.js");

describe("layer migration", () => {
  it("gives a workspace saved before layers the one default layer", () => {
    state.stored = { theme: "light" };
    const settings = getSettings();
    expect(settings.layers).toEqual([{ id: "main", name: "Main" }]);
    expect(settings.activeLayer).toBe("main");
    expect(settings.groups).toEqual([]);
  });

  it("falls back to the first layer when the active one was deleted", () => {
    state.stored = { workspaces: [{ id: "default", name: "Default", layers: [{ id: "work", name: "Work" }], activeLayer: "gone" }] };
    expect(getSettings().activeLayer).toBe("work");
  });

  it("drops a group whose layer is gone", () => {
    state.stored = { workspaces: [{
      id: "default", name: "Default",
      layers: [{ id: "work", name: "Work" }],
      groups: [{ id: "a", layer: "work", name: "Repos" }, { id: "b", layer: "gone", name: "Orphan" }],
    }] };
    expect(getSettings().groups.map((group) => group.id)).toEqual(["a"]);
  });

  it("keeps each workspace's layers to itself", () => {
    state.stored = {
      activeWorkspace: "one",
      workspaces: [
        { id: "one", name: "One", layers: [{ id: "l1", name: "Work" }], activeLayer: "l1" },
        { id: "two", name: "Two", layers: [{ id: "l2", name: "Personal" }], activeLayer: "l2" },
      ],
    };
    updateSettings({ layers: [{ id: "l1", name: "Renamed" }] });
    const saved = getSettings().workspaces;
    expect(saved.find((workspace) => workspace.id === "one")?.layers[0].name).toBe("Renamed");
    expect(saved.find((workspace) => workspace.id === "two")?.layers[0].name).toBe("Personal");
  });
});

describe("layerOf", () => {
  const layers = [{ id: "work" }, { id: "personal" }];

  it("keeps a terminal in the layer it was stamped with", () => {
    expect(layerOf("personal", layers)).toBe("personal");
  });

  it("puts an unstamped terminal in the first layer", () => {
    expect(layerOf(undefined, layers)).toBe("work");
  });

  it("puts a terminal of a deleted layer in the first layer", () => {
    expect(layerOf("gone", layers)).toBe("work");
  });
});

const { restoredTabs, pausedTab } = await import("../src/renderer/src/lib/restore.js");

const remembered = (id: string, layer: string, extra: Record<string, unknown> = {}) =>
  ({ id, layer, title: id, ...extra });

describe("restoring tabs after a quit", () => {
  it("brings back a remembered tab as paused, in its layer and group", () => {
    const [tab] = restoredTabs([], [remembered("t1", "work", { group: "repos", cwd: "/src/deck", agent: "claude", sessionId: "claude:abc" })]);
    expect(tab.paused).toBe(true);
    expect(tab.layerId).toBe("work");
    expect(tab.groupId).toBe("repos");
    expect(tab.sessionId).toBe("claude:abc");
  });

  it("keeps a terminal that is still running over the remembered copy", () => {
    const live = [{ termId: "t1", title: "shell", cwd: "/src/deck" }];
    const tabs = restoredTabs(live, [remembered("t1", "work")]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].paused).toBeUndefined();
  });

  it("holds the order deck last had, running and paused alike", () => {
    const live = [{ termId: "t2", title: "shell" }];
    const tabs = restoredTabs(live, [remembered("t1", "work"), remembered("t2", "work"), remembered("t3", "work")]);
    expect(tabs.map((tab) => tab.termId)).toEqual(["t1", "t2", "t3"]);
    expect(tabs.map((tab) => Boolean(tab.paused))).toEqual([true, false, true]);
  });

  it("appends a terminal that outlived the window without being remembered", () => {
    const tabs = restoredTabs([{ termId: "new", title: "shell" }], [remembered("t1", "work")]);
    expect(tabs.map((tab) => tab.termId)).toEqual(["t1", "new"]);
  });

  it("carries a typed name onto the paused row", () => {
    expect(pausedTab(remembered("t1", "work", { customTitle: "deploy" })).customTitle).toBe("deploy");
  });
});
