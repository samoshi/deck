import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => Object.defineProperty(process, "platform", { value: "win32" }));

const { chordOf, defaultKeybinds, formatAccelerator, formatChord, matchKeybind, primaryHeld } = await import("../src/shared/keybinds.js");

const press = (over: Partial<Parameters<typeof chordOf>[0]>) => ({ key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

describe("keybinds on Windows", () => {
  it("binds nothing to the Windows key, which the OS keeps for itself", () => {
    expect(Object.values(defaultKeybinds).filter((chord) => chord.includes("Meta"))).toEqual([]);
  });

  it("gives every default chord one command", () => {
    const chords = Object.values(defaultKeybinds);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it("leaves Ctrl+letter to the shell, apart from the font size keys", () => {
    const bare = Object.values(defaultKeybinds).filter((chord) => /^Ctrl\+[A-Z]$/.test(chord));
    expect(bare).toEqual([]);
  });

  it("follows WezTerm for splits and pane moves", () => {
    expect(matchKeybind(defaultKeybinds, press({ key: "ArrowRight", code: "ArrowRight", ctrlKey: true, shiftKey: true }))).toBe("split.right");
    expect(matchKeybind(defaultKeybinds, press({ key: "ArrowUp", code: "ArrowUp", altKey: true }))).toBe("splitAgent.up");
    expect(matchKeybind(defaultKeybinds, press({ key: "ArrowLeft", code: "ArrowLeft", ctrlKey: true }))).toBe("pane.left");
    expect(matchKeybind(defaultKeybinds, press({ key: "T", code: "KeyT", ctrlKey: true, shiftKey: true }))).toBe("tab.new");
  });

  it("spells chords out instead of using Mac symbols", () => {
    expect(formatChord(defaultKeybinds["tab.new"])).toBe("Ctrl+Shift+T");
    expect(formatChord(defaultKeybinds["view.board"])).toBe("Ctrl+Alt+2");
    expect(formatAccelerator("CommandOrControl+Shift+Space")).toBe("Ctrl+Shift+Space");
  });

  it("takes Ctrl+Shift as the primary modifier", () => {
    expect(primaryHeld({ metaKey: false, ctrlKey: true, shiftKey: true })).toBe(true);
    expect(primaryHeld({ metaKey: false, ctrlKey: true, shiftKey: false })).toBe(false);
    expect(primaryHeld({ metaKey: true, ctrlKey: false, shiftKey: false })).toBe(false);
  });
});
