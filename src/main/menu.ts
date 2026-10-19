import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { acceleratorOf, resolveKeybinds, type KeybindCommand, type Keybinds } from "../shared/keybinds.js";
import { liveStatus, rebuildAndReload, useInstalled } from "./liveReload.js";
import { getSettings } from "./settings.js";

// Replaces electron's stock menu, which has no Settings item. Menu items send
// the command ids the renderer already binds keys to, and take their
// accelerators from the user's own keybinds.

const isMac = process.platform === "darwin";

function command(label: string, id: KeybindCommand, keybinds: Keybinds): MenuItemConstructorOptions {
  return {
    label,
    accelerator: acceleratorOf(keybinds[id]),
    click: () => BrowserWindow.getFocusedWindow()?.webContents.send("menu:command", id),
  };
}

// Fixed, not a keybind: the renderer never sees it, so nothing in a terminal can press it.
function liveItems(): MenuItemConstructorOptions[] {
  const { running } = liveStatus();
  return [
    { label: "Rebuild and Reload", accelerator: "CmdOrCtrl+Shift+R", click: () => void rebuildAndReload() },
    running
      ? { label: `Use Installed Deck (now ${running.commit})`, click: useInstalled }
      : { label: "Running the installed Deck", enabled: false },
  ];
}

export function installAppMenu(): void {
  const keybinds = resolveKeybinds(getSettings().keybinds);
  const settings = command("Settings…", "settings", keybinds);
  const live = app.isPackaged ? [{ type: "separator" as const }, ...liveItems()] : [];
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" as const },
            { type: "separator" as const },
            settings,
            ...live,
            { type: "separator" as const },
            { role: "services" as const },
            { type: "separator" as const },
            { role: "hide" as const },
            { role: "hideOthers" as const },
            { role: "unhide" as const },
            { type: "separator" as const },
            { role: "quit" as const },
          ],
        }]
      : [{ label: "File", submenu: [settings, ...live, { type: "separator" as const }, { role: "quit" as const }] }]),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        command("Terminal", "view.terminal", keybinds),
        command("Board", "view.board", keybinds),
        command("Agent", "view.agent", keybinds),
        command("Reviews", "view.reviews", keybinds),
        { type: "separator" },
        command("Zen", "zen", keybinds),
        command("Presentation", "presentation", keybinds),
        { type: "separator" },
        command("Next Workspace", "workspace.next", keybinds),
        command("Previous Workspace", "workspace.prev", keybinds),
        { type: "separator" },
        command("Larger Terminal Text", "font.increase", keybinds),
        command("Smaller Terminal Text", "font.decrease", keybinds),
        command("Actual Terminal Text Size", "font.reset", keybinds),
        { type: "separator" },
        command("Search", "search", keybinds),
        command("Toggle Sidebar", "sidebar", keybinds),
        command("Keyboard Shortcuts", "shortcuts", keybinds),
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Window",
      submenu: [
        command("New Window", "window.new", keybinds),
        { type: "separator" },
        { role: "minimize" },
        { role: "zoom" },
        { role: "close" },
        ...(isMac ? [{ type: "separator" as const }, { role: "front" as const }] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
