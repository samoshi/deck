import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ipcMain, shell } from "electron";
import { getSettings } from "./settings.js";

const exec = promisify(execFile);

/** The last address the command printed. Last, not first, so a tool is free to
 *  say what it is doing before it says where it ended up. */
function urlIn(output: string): string | undefined {
  return output.match(/https?:\/\/\S+/g)?.at(-1);
}

export interface ButtonResult {
  ok: boolean;
  error?: string;
}

/** Runs a sidebar button's command in the user's login shell, so it sees the
 *  PATH their terminal would. A button that opens a URL has it read off the
 *  output rather than stored, because a local tool's port and token can change
 *  between one press and the next. */
export function registerCustomButtons(): void {
  ipcMain.handle("customButton:run", async (_event, id: string): Promise<ButtonResult> => {
    const button = getSettings().customButtons.find((candidate) => candidate.id === id);
    if (!button) return { ok: false, error: "That button is gone from settings" };
    try {
      const { stdout } = await exec(process.env.SHELL ?? "/bin/zsh", ["-lc", button.command], { timeout: 30_000 });
      if (!button.opensUrl) return { ok: true };
      const url = urlIn(stdout);
      if (!url) return { ok: false, error: `${button.label} printed no address to open` };
      await shell.openExternal(url);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
