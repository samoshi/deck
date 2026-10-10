/** Rebindable keyboard shortcuts. A chord is stored as modifiers and a key
 *  joined by "+", e.g. "Meta+Shift+T" or "Meta+Alt+Digit1". Letters and digits
 *  come from the physical key so ⌥3 (which types "£" on a Mac) still matches. */

export type KeybindCommand =
  | "search" | "settings" | "shortcuts" | "sidebar" | "window.new"
  | "view.terminal" | "view.board" | "view.agent" | "view.reviews"
  | "zen" | "presentation"
  | "workspace.next" | "workspace.prev"
  | "layer.next" | "layer.prev"
  | "tab.new" | "tab.newAgent" | "tab.close" | "tab.reopen" | "tab.next" | "tab.prev"
  | "split.up" | "split.down" | "split.left" | "split.right"
  | "splitAgent.up" | "splitAgent.down" | "splitAgent.left" | "splitAgent.right"
  | "pane.up" | "pane.down" | "pane.left" | "pane.right" | "pane.zoom"
  | "find" | "composer" | "changes" | "canvas"
  | "font.increase" | "font.decrease" | "font.reset";

export type Keybinds = Record<KeybindCommand, string>;

/** The OS this runs on, from the main process or a renderer alike. */
export const platform: "darwin" | "win32" | "linux" =
  typeof process !== "undefined" && typeof process.platform === "string"
    ? (process.platform as "darwin" | "win32" | "linux")
    : /Windows/.test(navigator.userAgent) ? "win32" : /Mac/.test(navigator.userAgent) ? "darwin" : "linux";

export const isMac = platform === "darwin";

/** Off macOS there is no ⌘: Ctrl+letter belongs to the shell, so app
 *  shortcuts take Ctrl+Shift the way Windows Terminal and WezTerm do, and the
 *  splits and pane moves follow WezTerm's arrows. */
const otherDefaults: Partial<Keybinds> = {
  search: "Ctrl+Shift+K",
  settings: "Ctrl+,",
  shortcuts: "Ctrl+/",
  sidebar: "Ctrl+Shift+B",
  "window.new": "Ctrl+Shift+N",
  "view.terminal": "Ctrl+Alt+Digit1",
  "view.board": "Ctrl+Alt+Digit2",
  "view.agent": "Ctrl+Alt+Digit3",
  "view.reviews": "Ctrl+Alt+Digit4",
  zen: "Ctrl+Shift+Enter",
  presentation: "Ctrl+Shift+P",
  "workspace.next": "Ctrl+Shift+]",
  "workspace.prev": "Ctrl+Shift+[",
  "layer.next": "Ctrl+Alt+Shift+ArrowDown",
  "layer.prev": "Ctrl+Alt+Shift+ArrowUp",
  "tab.new": "Ctrl+Shift+T",
  "tab.newAgent": "Ctrl+Shift+A",
  "tab.close": "Ctrl+Shift+W",
  "tab.reopen": "Ctrl+Alt+Shift+T",
  "split.up": "Ctrl+Shift+ArrowUp",
  "split.down": "Ctrl+Shift+ArrowDown",
  "split.left": "Ctrl+Shift+ArrowLeft",
  "split.right": "Ctrl+Shift+ArrowRight",
  "splitAgent.up": "Alt+ArrowUp",
  "splitAgent.down": "Alt+ArrowDown",
  "splitAgent.left": "Alt+ArrowLeft",
  "splitAgent.right": "Alt+ArrowRight",
  "pane.up": "Ctrl+ArrowUp",
  "pane.down": "Ctrl+ArrowDown",
  "pane.left": "Ctrl+ArrowLeft",
  "pane.right": "Ctrl+ArrowRight",
  "pane.zoom": "Ctrl+Shift+Z",
  find: "Ctrl+Shift+F",
  composer: "Ctrl+Shift+J",
  changes: "Ctrl+Shift+G",
  canvas: "Ctrl+Shift+E",
  "font.increase": "Ctrl+=",
  "font.decrease": "Ctrl+-",
  "font.reset": "Ctrl+Digit0",
};

/** The modifier the hard-wired chords (⌘1–9, ⌘⌫, ⌘⏎) use: ⌘ on a Mac, Ctrl+Shift elsewhere. */
export function primaryHeld(event: Pick<KeyPress, "metaKey" | "ctrlKey" | "shiftKey">): boolean {
  return isMac ? event.metaKey : event.ctrlKey && event.shiftKey && !event.metaKey;
}

export interface KeybindInfo {
  id: KeybindCommand;
  label: string;
  group: "Workbench" | "Terminal";
  default: string;
}

export const keybindInfos: KeybindInfo[] = [
  { id: "search", label: "Search sessions, history, commands, settings, themes and repositories", group: "Workbench", default: "Meta+K" },
  { id: "settings", label: "Open settings", group: "Workbench", default: "Meta+," },
  { id: "shortcuts", label: "Show keyboard shortcuts", group: "Workbench", default: "Meta+/" },
  { id: "sidebar", label: "Toggle sidebar", group: "Workbench", default: "Meta+B" },
  { id: "window.new", label: "New window", group: "Workbench", default: "Meta+N" },
  { id: "view.terminal", label: "Terminal page", group: "Workbench", default: "Meta+Alt+Digit1" },
  { id: "view.board", label: "Board page", group: "Workbench", default: "Meta+Alt+Digit2" },
  { id: "view.agent", label: "Agent page", group: "Workbench", default: "Meta+Alt+Digit3" },
  { id: "view.reviews", label: "Reviews page", group: "Workbench", default: "Meta+Alt+Digit4" },
  { id: "zen", label: "Toggle Zen view", group: "Workbench", default: "Meta+Shift+Enter" },
  { id: "presentation", label: "Toggle Presentation view", group: "Workbench", default: "Meta+Shift+P" },
  { id: "workspace.next", label: "Next workspace", group: "Workbench", default: "Meta+Shift+]" },
  { id: "workspace.prev", label: "Previous workspace", group: "Workbench", default: "Meta+Shift+[" },
  // The splits take ⌘⌥ and ⌘⇧ with the arrows; layers sit a tier above them.
  { id: "layer.next", label: "Next layer", group: "Workbench", default: "Meta+Alt+Shift+ArrowDown" },
  { id: "layer.prev", label: "Previous layer", group: "Workbench", default: "Meta+Alt+Shift+ArrowUp" },
  { id: "tab.new", label: "New terminal tab", group: "Terminal", default: "Meta+T" },
  { id: "tab.newAgent", label: "New tab running the default agent", group: "Terminal", default: "Meta+Shift+N" },
  { id: "tab.close", label: "Close the active tab", group: "Terminal", default: "Meta+W" },
  { id: "tab.reopen", label: "Reopen the last closed tab", group: "Terminal", default: "Meta+Shift+T" },
  { id: "tab.next", label: "Next tab", group: "Terminal", default: "Ctrl+Tab" },
  { id: "tab.prev", label: "Previous tab", group: "Terminal", default: "Ctrl+Shift+Tab" },
  { id: "split.up", label: "Split up", group: "Terminal", default: "Meta+Shift+ArrowUp" },
  { id: "split.down", label: "Split down", group: "Terminal", default: "Meta+Shift+ArrowDown" },
  { id: "split.left", label: "Split left", group: "Terminal", default: "Meta+Shift+ArrowLeft" },
  { id: "split.right", label: "Split right", group: "Terminal", default: "Meta+Shift+ArrowRight" },
  { id: "splitAgent.up", label: "Split up running the default agent", group: "Terminal", default: "Meta+Alt+ArrowUp" },
  { id: "splitAgent.down", label: "Split down running the default agent", group: "Terminal", default: "Meta+Alt+ArrowDown" },
  { id: "splitAgent.left", label: "Split left running the default agent", group: "Terminal", default: "Meta+Alt+ArrowLeft" },
  { id: "splitAgent.right", label: "Split right running the default agent", group: "Terminal", default: "Meta+Alt+ArrowRight" },
  { id: "pane.up", label: "Focus the pane above", group: "Terminal", default: "Meta+Ctrl+ArrowUp" },
  { id: "pane.down", label: "Focus the pane below", group: "Terminal", default: "Meta+Ctrl+ArrowDown" },
  { id: "pane.left", label: "Focus the pane to the left", group: "Terminal", default: "Meta+Ctrl+ArrowLeft" },
  { id: "pane.right", label: "Focus the pane to the right", group: "Terminal", default: "Meta+Ctrl+ArrowRight" },
  { id: "pane.zoom", label: "Zoom the focused pane", group: "Terminal", default: "Meta+Z" },
  { id: "find", label: "Find in terminal output", group: "Terminal", default: "Meta+F" },
  { id: "composer", label: "Toggle multiline input", group: "Terminal", default: "Meta+J" },
  { id: "changes", label: "Toggle the changes panel", group: "Terminal", default: "Meta+E" },
  { id: "canvas", label: "Toggle the canvas panel", group: "Terminal", default: "Meta+Shift+E" },
  { id: "font.increase", label: "Larger terminal text", group: "Terminal", default: "Meta+=" },
  { id: "font.decrease", label: "Smaller terminal text", group: "Terminal", default: "Meta+-" },
  { id: "font.reset", label: "Reset terminal text size", group: "Terminal", default: "Meta+Digit0" },
];

if (!isMac) for (const info of keybindInfos) info.default = otherDefaults[info.id] ?? info.default;

export const defaultKeybinds = Object.fromEntries(keybindInfos.map((info) => [info.id, info.default])) as Keybinds;

/** Fills gaps in a stored override map with the defaults. */
export function resolveKeybinds(overrides: Partial<Keybinds> | undefined): Keybinds {
  return { ...defaultKeybinds, ...overrides };
}

/** The chord a keyboard event represents, or undefined for a bare modifier press. */
/** The parts of a KeyboardEvent a chord is built from; kept local so this file also compiles for the main process. */
export interface KeyPress { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

/** Keys whose character shifts with the layout or the Shift state; ⌘⇧[ has
 *  to stay "[" rather than becoming "{". */
const physicalKeys: Record<string, string> = { BracketLeft: "[", BracketRight: "]" };

export function chordOf(event: KeyPress): string | undefined {
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return undefined;
  const modifiers = [event.metaKey && "Meta", event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean);
  const physical = /^(Digit\d|Key[A-Z])$/.exec(event.code)?.[0];
  const key = physical ? (physical.startsWith("Key") ? physical.slice(3) : physical)
    : physicalKeys[event.code] ?? (event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return [...modifiers, key].join("+");
}

/** A command with an empty chord is unbound: it keeps its palette and menu
 *  entries and never answers to a key press. */
export function matchKeybind(keybinds: Keybinds, event: KeyPress): KeybindCommand | undefined {
  const chord = chordOf(event);
  return chord ? (Object.keys(keybinds) as KeybindCommand[]).find((id) => keybinds[id] && keybinds[id] === chord) : undefined;
}

const symbols: Record<string, string> = { Meta: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Enter: "⏎", Escape: "esc", Backspace: "⌫", Tab: "⇥", Space: "space", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };

const acceleratorParts: Record<string, string> = { Meta: "CommandOrControl", Ctrl: "Control", Enter: "Return", Escape: "Esc", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };

/** "Meta+Alt+Digit1" as the electron accelerator "CommandOrControl+Alt+1". */
export function acceleratorOf(chord: string): string | undefined {
  const parts = chord.split("+").map((part) => acceleratorParts[part] ?? part.replace(/^Digit/, ""));
  return parts.length > 1 ? parts.join("+") : undefined;
}

const words: Record<string, string> = { Meta: "Win", Escape: "Esc", Backspace: "Backspace", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };

/** "Meta+Shift+Enter" as "⌘⇧⏎" for display; "Ctrl+Shift+T" stays spelled out off macOS. */
export function formatChord(chord: string): string {
  if (!isMac) return chord.split("+").map((part) => words[part] ?? part.replace(/^Digit/, "")).join("+");
  return chord.split("+").map((part) => symbols[part] ?? part.replace(/^Digit/, "")).join("");
}

const acceleratorSymbols: Record<string, string> = { CommandOrControl: "⌘", Command: "⌘", Cmd: "⌘", Super: "⌘", Control: "⌃", Option: "⌥", Return: "⏎" };

/** "CommandOrControl+Shift+Space" as "⌘⇧space" for display. The summon hotkey
 *  is stored as an accelerator rather than a chord, so it formats from here. */
export function formatAccelerator(accelerator: string): string {
  if (!isMac) return accelerator.replace(/CommandOrControl|CmdOrCtrl/g, "Ctrl").replace("Control", "Ctrl");
  return accelerator.split("+").map((part) => acceleratorSymbols[part] ?? symbols[part] ?? part).join("");
}
