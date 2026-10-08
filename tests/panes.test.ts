import { describe, expect, it } from "vitest";
import { arrangePane, paneIds, releasePane, removePane, renamePane, splitFor, splitPane, syncLayouts, type PaneLayout } from "../src/renderer/src/terminal/layout.js";

const split = (first: string, second: string, ratio = 0.5): PaneLayout =>
  ({ direction: "row", ratio, first: { termId: first }, second: { termId: second } });

describe("renamePane", () => {
  it("points a leaf at the terminal that replaced it, keeping the split", () => {
    expect(renamePane(split("a", "b", 0.3), "b", "b2")).toEqual({ direction: "row", ratio: 0.3, first: { termId: "a" }, second: { termId: "b2" } });
  });

  it("hands back the very same tree when it holds no such id", () => {
    const layout = split("a", "b");
    expect(renamePane(layout, "zzz", "new")).toBe(layout);
  });

  it("reaches a leaf nested two splits deep", () => {
    const layout: PaneLayout = { direction: "column", ratio: 0.5, first: { termId: "a" }, second: split("b", "c") };
    expect(paneIds(renamePane(layout, "c", "c2"))).toEqual(["a", "b", "c2"]);
  });
});

describe("removePane", () => {
  it("collapses the split the pane leaves behind", () => {
    expect(removePane(split("a", "b"), "b")).toEqual({ termId: "a" });
  });

  it("answers with nothing when the last pane goes", () => {
    expect(removePane({ termId: "a" }, "a")).toBeUndefined();
  });

  it("keeps the rest of a nested tree", () => {
    const layout: PaneLayout = { direction: "column", ratio: 0.5, first: { termId: "a" }, second: split("b", "c") };
    expect(paneIds(removePane(layout, "b")!)).toEqual(["a", "c"]);
  });
});

describe("syncLayouts", () => {
  it("gives a tab deck has never laid out a pane of its own", () => {
    expect(syncLayouts([], ["a", "b"])).toEqual([{ termId: "a" }, { termId: "b" }]);
  });

  it("drops a pane whose terminal is gone and collapses its split", () => {
    expect(syncLayouts([split("a", "b")], ["a"])).toEqual([{ termId: "a" }]);
  });

  // The bug this guards: the caller used to pass one layer's tabs, so
  // switching layers pruned every split belonging to the layers left behind.
  it("keeps a split whose tabs sit in a layer that is not on screen", () => {
    expect(syncLayouts([split("a", "b")], ["a", "b", "c"]))
      .toEqual([split("a", "b"), { termId: "c" }]);
  });

  // The terminal's created event can reach the store before the call that
  // made it returns, so the resumed id lands in a pane of its own as well.
  it("leaves a terminal in one tree when two hold it", () => {
    expect(syncLayouts([split("a", "b"), { termId: "b" }], ["a", "b"]))
      .toEqual([split("a", "b")]);
  });

  it("keeps the whole list stable when nothing changed", () => {
    const layouts = [split("a", "b"), { termId: "c" }];
    expect(syncLayouts(syncLayouts(layouts, ["a", "b", "c"]), ["a", "b", "c"])).toEqual(layouts);
  });
});

describe("a split that outlives a restart", () => {
  // Resuming a paused tab starts a new terminal under a new id. Without the
  // rename the old leaf is dead and the next sync flattens the pair.
  it("follows both panes through their resume", () => {
    const { direction, before } = splitFor.right;
    let layouts = [splitPane({ termId: "a" }, "a", "b", direction, before)];

    layouts = layouts.map((layout) => renamePane(layout, "a", "a2"));
    layouts = syncLayouts(layouts, ["a2", "b"]);
    layouts = layouts.map((layout) => renamePane(layout, "b", "b2"));
    layouts = syncLayouts(layouts, ["a2", "b2"]);

    expect(layouts).toHaveLength(1);
    expect(paneIds(layouts[0])).toEqual(["a2", "b2"]);
  });

  it("flattens without the rename, which is what the user saw", () => {
    const layouts = syncLayouts([split("a", "b")], ["a2", "b2"]);
    expect(layouts).toEqual([{ termId: "a2" }, { termId: "b2" }]);
  });
});

describe("arrangePane", () => {
  const left = (layouts: PaneLayout[], termId: string, target: string) =>
    arrangePane(layouts, termId, target, splitFor.left.direction, splitFor.left.before);

  it("moves a tab out of its own pane and into the target's split", () => {
    expect(left([{ termId: "a" }, { termId: "b" }], "b", "a"))
      .toEqual([{ direction: "row", ratio: 0.5, first: { termId: "b" }, second: { termId: "a" } }]);
  });

  it("leaves no second copy behind when the tab came from another split", () => {
    const arranged = left([split("a", "b"), split("c", "d")], "d", "a");
    expect(arranged.flatMap(paneIds).sort()).toEqual(["a", "b", "c", "d"]);
    expect(arranged).toHaveLength(2);
    expect(paneIds(arranged[1])).toEqual(["c"]);
  });

  it("reorders within one split when both panes are already in it", () => {
    expect(left([split("a", "b")], "b", "a"))
      .toEqual([{ direction: "row", ratio: 0.5, first: { termId: "b" }, second: { termId: "a" } }]);
  });

  it("refuses to put a pane beside itself", () => {
    const layouts = [split("a", "b")];
    expect(left(layouts, "a", "a")).toBe(layouts);
  });

  it("touches no layout the move has nothing to do with", () => {
    const other = split("c", "d");
    expect(left([{ termId: "a" }, { termId: "b" }, other], "b", "a")[1]).toBe(other);
  });
});

describe("releasePane", () => {
  // Layouts are no longer pruned against the layer on screen, so a tab sent to
  // another layer has to be taken out of its split or it leaves a hole in it.
  it("collapses the split it leaves and keeps a pane of its own", () => {
    expect(releasePane([split("a", "b")], "b")).toEqual([{ termId: "a" }, { termId: "b" }]);
  });

  it("leaves the layouts it is not part of alone", () => {
    const other = split("a", "b");
    const released = releasePane([other, { termId: "c" }], "c");
    expect(released[0]).toBe(other);
    expect(released).toEqual([other, { termId: "c" }]);
  });
});
