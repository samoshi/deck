import { describe, expect, it } from "vitest";
import { builtInThemes, parseTheme } from "../src/shared/themes.js";

const hues = ["red", "green", "yellow", "blue", "magenta", "cyan"] as const;

describe("terminal colours follow the theme", () => {
  it.each(builtInThemes)("dresses $name's terminal window in its own colours", (theme) => {
    expect(theme.terminal.background).toBe(theme.colors.bg);
    expect(theme.terminal.foreground).toBe(theme.colors.ink);
    expect(theme.terminal.cursor).toBe(theme.colors.accent);
  });

  it("reads the ANSI hues off the palette where the theme names them all", () => {
    const carbon = builtInThemes.find((theme) => theme.id === "dark")!;
    expect(carbon.terminal.red).toBe(carbon.colors.red);
    expect(carbon.terminal.green).toBe(carbon.colors.green);
    expect(carbon.terminal.blue).toBe(carbon.colors.blue);
    expect(carbon.terminal.yellow).toBe(carbon.colors.orange);
    expect(carbon.terminal.magenta).toBe(carbon.colors.accent);
  });

  it.each(builtInThemes)("gives $name six ANSI hues that can be told apart", (theme) => {
    const used = hues.map((hue) => theme.terminal[hue]);
    expect(new Set(used).size).toBe(hues.length);
  });

  it("keeps black dark and white light whichever way the theme runs", () => {
    const dark = builtInThemes.find((theme) => theme.id === "dark")!;
    const paper = builtInThemes.find((theme) => theme.id === "light")!;
    expect(dark.terminal.black).toBe(dark.colors.card2);
    expect(dark.terminal.brightWhite).toBe(dark.colors.ink);
    // A light theme's darkest colour is its text, so that is what black takes.
    expect(paper.terminal.black).toBe(paper.colors.ink);
    expect(paper.terminal.brightWhite).toBe(paper.colors.bg);
  });
});

describe("custom themes", () => {
  it("carries a recoloured accent into the terminal", () => {
    const theme = parseTheme({ id: "probe", name: "Probe", extends: "forest", colors: { accent: "#abcd12" } });
    expect(theme.terminal.cursor).toBe("#abcd12");
    expect(theme.terminal.magenta).toBe("#abcd12");
  });

  it("lets a named terminal colour override what the palette would give", () => {
    const theme = parseTheme({ id: "probe", name: "Probe", colors: { red: "#ff0000" }, terminal: { red: "#00ff00" } });
    expect(theme.terminal.red).toBe("#00ff00");
    expect(theme.colors.red).toBe("#ff0000");
  });

  it("follows a light theme's ramp when the appearance is light", () => {
    const theme = parseTheme({ id: "probe", name: "Probe", appearance: "light", colors: { ink: "#111111", bg: "#ffffff" } });
    expect(theme.terminal.black).toBe("#111111");
    expect(theme.terminal.brightWhite).toBe("#ffffff");
  });
});
