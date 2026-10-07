import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { paneIds, paneInDirection, paneRects, pruneLayout, splitFor, splitPane, zoomPane, type PaneRect } from "../src/renderer/src/terminal/layout.js";
import { listFiles, readLocalFile, saveLocalFile } from "../src/main/files.js";

describe("split layout", () => {
  it("keeps nested panes and their geometry when an unrelated pane closes", () => {
    const pair = splitPane({ termId: "one" }, "one", "two", "row");
    const nested = splitPane(pair, "two", "three", "column");
    expect(paneIds(nested)).toEqual(["one", "two", "three"]);
    expect(paneRects(nested)).toEqual([
      { termId: "one", left: 0, top: 0, width: 50, height: 100 },
      { termId: "two", left: 50, top: 0, width: 50, height: 50 },
      { termId: "three", left: 50, top: 50, width: 50, height: 50 },
    ]);
    const surviving = pruneLayout(nested, new Set(["one", "three"]));
    expect(paneRects(surviving!)[1]).toEqual({ termId: "three", left: 50, top: 0, width: 50, height: 100 });
    expect(pruneLayout(nested, new Set())).toBeUndefined();
  });

  it("puts the new pane before the target for a split up or left", () => {
    const left = splitPane({ termId: "one" }, "one", "two", splitFor.left.direction, splitFor.left.before);
    expect(paneRects(left)).toEqual([
      { termId: "two", left: 0, top: 0, width: 50, height: 100 },
      { termId: "one", left: 50, top: 0, width: 50, height: 100 },
    ]);
    const up = splitPane({ termId: "one" }, "one", "two", splitFor.up.direction, splitFor.up.before);
    expect(paneIds(up)).toEqual(["two", "one"]);
    expect(paneRects(up)[0]).toEqual({ termId: "two", left: 0, top: 0, width: 100, height: 50 });
  });

  it("walks to the nearest overlapping pane and stops at the edge", () => {
    const pair = splitPane({ termId: "one" }, "one", "two", "row");
    const nested = splitPane(pair, "two", "three", "column");
    expect(paneInDirection(nested, "one", "right")).toBe("two");
    expect(paneInDirection(nested, "two", "left")).toBe("one");
    expect(paneInDirection(nested, "two", "down")).toBe("three");
    expect(paneInDirection(nested, "three", "up")).toBe("two");
    expect(paneInDirection(nested, "one", "left")).toBeUndefined();
    expect(paneInDirection(nested, "one", "down")).toBeUndefined();
    expect(paneInDirection(nested, "missing", "up")).toBeUndefined();
  });

  it("grows every split towards the zoomed pane and leaves the others on screen", () => {
    const pair = splitPane({ termId: "one" }, "one", "two", "row");
    const nested = splitPane(pair, "two", "three", "column");
    const round = ({ termId, left, top, width, height }: PaneRect) => ({ termId, left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) });
    const rects = paneRects(zoomPane(nested, "three")).map(round);
    expect(rects).toEqual([
      { termId: "one", left: 0, top: 0, width: 15, height: 100 },
      { termId: "two", left: 15, top: 0, width: 85, height: 15 },
      { termId: "three", left: 15, top: 15, width: 85, height: 85 },
    ]);
    expect(zoomPane(nested, "missing")).toEqual(nested);
  });
});

describe("local file explorer", () => {
  it("browses and edits text, preventing traversal, symlink escape and stale writes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "deck-files-"));
    try {
      const root = path.join(dir, "project");
      await fs.mkdir(root);
      await fs.writeFile(path.join(root, "notes.md"), "original");
      await fs.writeFile(path.join(root, ".env"), "SECRET=1");
      await fs.mkdir(path.join(root, ".git"));
      await fs.mkdir(path.join(root, "node_modules"));
      await fs.writeFile(path.join(dir, "outside.txt"), "outside");
      await fs.symlink(path.join(dir, "outside.txt"), path.join(root, "link.txt"));
      expect((await listFiles(root)).map((entry) => entry.name)).toEqual(["link.txt", "notes.md"]);
      const loaded = await readLocalFile(root, "notes.md");
      const saved = await saveLocalFile(root, "notes.md", { ...loaded, text: "updated" });
      expect((await readLocalFile(root, "notes.md")).text).toBe("updated");
      await expect(readLocalFile(root, "../outside.txt")).rejects.toThrow("outside");
      await expect(readLocalFile(root, "link.txt")).rejects.toThrow("outside");
      await expect(saveLocalFile(root, "notes.md", { text: "old", modified: saved.modified - 1000 })).rejects.toThrow("changed on disk");
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
