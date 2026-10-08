import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { builtInThemes, parseTheme } from "../src/shared/themes.js";
import { parsePluginAction } from "../src/shared/extensions.js";

const fixture = vi.hoisted(() => ({ root: "", settings: new Map<string, unknown>() }));
vi.mock("electron", () => ({ app: { getPath: () => fixture.root }, dialog: {}, shell: {} }));
vi.mock("../src/main/db.js", () => ({ kvGet: (key: string) => fixture.settings.get(key), kvSet: (key: string, value: unknown) => fixture.settings.set(key, value) }));
import { enablePlugin, extensionCatalog, loadPlugin, onActiveThemeChanged, pluginFile, resolveThemeId, saveTheme, startExtensions, stopExtensions, writeActiveTheme } from "../src/main/extensions.js";
fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-extensions-"));
afterAll(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

describe("custom themes", () => {
  it("inherits light colors, follows UI overrides in terminals, and persists a reloadable custom theme", () => {
    const theme = parseTheme({ id: "test-paper", name: "Test Paper", extends: "light", colors: { bg: "#ffffff", accent: "#123456" }, terminal: { red: "#990000" } });
    expect(theme.appearance).toBe("light");
    expect(theme.colors.ink).toBe(builtInThemes[4].colors.ink);
    expect(theme.terminal).toMatchObject({ background: "#ffffff", cursor: "#123456", red: "#990000" });
    expect(saveTheme(theme).id).toBe("custom:test-paper");
    expect(extensionCatalog().themes.find((candidate) => candidate.id === "custom:test-paper")?.terminal).toEqual(theme.terminal);
  });
  it("rejects invalid styles, traversal ids and malformed palettes without losing other themes", () => {
    for (const patch of [{ id: "../escape" }, { appearance: "system" }, { extends: "absent" }, { colors: { accent: "url(file:///etc/passwd)" } }, { colors: { missing: "#fff" } }, { terminal: [] }]) {
      expect(() => parseTheme({ id: "valid", name: "Valid", ...patch })).toThrow();
    }
    fs.writeFileSync(path.join(fixture.root, "themes", "broken.json"), "{");
    const catalog = extensionCatalog();
    expect(catalog.errors[0]).toContain("broken.json");
    expect(catalog.themes.some((theme) => theme.id === "custom:test-paper")).toBe(true);
  });
});

describe("local plugins", () => {
  it("loads the real starter, discovers it, and removes contributions when disabled", () => {
    const destination = path.join(fixture.root, "plugins", "workspace-kit");
    fs.cpSync(path.resolve("examples/plugins/workspace-kit"), destination, { recursive: true });
    const plugin = loadPlugin(destination);
    expect(plugin.commands.map((command) => command.action?.type)).toEqual(["theme", "terminal", "terminal"]);
    expect(plugin.source).toContain("registerCommand");
    expect(plugin.themes[0].id).toBe("workspace-kit:ocean");
    expect(extensionCatalog().plugins[0].enabled).toBe(true);
    enablePlugin(destination, false);
    expect(extensionCatalog().plugins[0]).toMatchObject({ enabled: false, themes: [], source: undefined });
    expect(extensionCatalog().themes.some((theme) => theme.id === "workspace-kit:ocean")).toBe(false);
    enablePlugin(destination, true);
    expect(extensionCatalog().themes.some((theme) => theme.id === "workspace-kit:ocean")).toBe(true);
  });
  it("rejects escaping plugin assets, duplicate commands and unsupported actions", () => {
    const root = path.join(fixture.root, "bad-plugin");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(fixture.root, "outside.js"), "export default () => {}");
    fs.symlinkSync(path.join(fixture.root, "outside.js"), path.join(root, "escape.js"));
    expect(() => pluginFile(root, "../outside.js")).toThrow("inside");
    expect(() => pluginFile(root, "escape.js")).toThrow("inside");
    fs.writeFileSync(path.join(root, "deck-plugin.json"), JSON.stringify({ apiVersion: 1, id: "bad", name: "Bad", version: "1", commands: [{ id: "same", title: "One" }, { id: "same", title: "Two" }] }));
    expect(() => loadPlugin(root)).toThrow("Duplicate");
    expect(() => parsePluginAction({ type: "terminal", agent: "unknown" })).toThrow("agent");
    expect(() => parsePluginAction({ type: "execute", code: "process.exit()" })).toThrow("Unsupported");
  });
});

describe("active theme file", () => {
  const file = (): string => path.join(fixture.root, "active-theme");

  it("resolves a full id, an unqualified id and a display name, and ignores what is ambiguous", () => {
    saveTheme({ id: "ocean-a", name: "Shared Name", extends: "dark" });
    saveTheme({ id: "ocean-b", name: "Shared Name", extends: "dark" });
    expect(resolveThemeId("midnight")).toBe("midnight");
    expect(resolveThemeId("custom:ocean-a")).toBe("custom:ocean-a");
    expect(resolveThemeId("ocean-a\n")).toBe("custom:ocean-a");
    expect(resolveThemeId("Rose Pine")).toBe("rose");
    for (const value of ["Shared Name", "absent", "   ", ""]) expect(resolveThemeId(value)).toBeUndefined();
  });

  it("follows an external write and ignores the echo of its own", async () => {
    const seen: string[] = [];
    fs.writeFileSync(file(), "dark\n");
    startExtensions();
    const off = onActiveThemeChanged((id) => seen.push(id));
    try {
      // Rewrite until the watcher is attached, rather than racing a fixed sleep.
      await vi.waitFor(() => {
        fs.writeFileSync(file(), "forest\n");
        expect(seen).toEqual(["forest"]);
      }, { timeout: 15000, interval: 600 });

      // Deck's own selection lands in the file without coming back as a change.
      writeActiveTheme("custom:ocean-b");
      expect(fs.readFileSync(file(), "utf8")).toBe("custom:ocean-b\n");
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(seen).toEqual(["forest"]);
    } finally {
      off();
      stopExtensions();
    }
  }, 30000);
});

describe("symlinked plugins", () => {
  it("finds a plugin symlinked into the plugins folder", () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "deck-plugin-"));
    fs.writeFileSync(path.join(target, "deck-plugin.json"), JSON.stringify({ apiVersion: 1, id: "linked", name: "Linked", version: "1.0.0", entry: "index.js" }));
    fs.writeFileSync(path.join(target, "index.js"), "export default {};");
    const plugins = path.join(fixture.root, "plugins");
    fs.mkdirSync(plugins, { recursive: true });
    fs.symlinkSync(target, path.join(plugins, "linked"));
    expect(extensionCatalog().plugins.map((plugin) => plugin.id)).toContain("linked");
  });
});
