import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

// On Windows, Deck is a native app whose terminals and agents live in WSL:
// claude, codex, the shell profile and ~/.claude are all on the Linux side.
// Everything Deck reads itself goes through Windows paths (E:\…, or
// \\wsl.localhost\<distro>\… for the Linux filesystem); everything it runs
// goes through wsl.exe, with paths turned back into Linux ones on the way.
// On macOS and Linux every helper here is the identity.

// DECK_WSL=0 keeps a Windows run native, paths and all; the test runner sets
// it so suites written against os.homedir() behave as they do on a Mac.
export const viaWsl = process.platform === "win32" && process.env.DECK_WSL !== "0";

interface Wsl {
  distro: string;
  /** $HOME inside the distro, as a Linux path. */
  home: string;
}

let wsl: Wsl | undefined;

/** The distro Deck runs in: DECK_WSL_DISTRO, else WSL's default. Asked once. */
export function wslInfo(): Wsl {
  if (!wsl) {
    const pick = process.env.DECK_WSL_DISTRO ? ["-d", process.env.DECK_WSL_DISTRO] : [];
    const out = execFileSync("wsl.exe", [...pick, "-e", "sh", "-c", 'echo "$WSL_DISTRO_NAME"; echo "$HOME"'], {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });
    const [distro = "", home = "/root"] = out.trim().split(/\r?\n/);
    wsl = { distro: distro.trim(), home: home.trim() };
  }
  return wsl;
}

/** "/mnt/e/x" as "E:\x" and "/home/me" as "\\wsl.localhost\<distro>\home\me". */
export function toWindowsPath(p: string): string {
  if (!viaWsl || !p.startsWith("/")) return p;
  const drive = /^\/mnt\/([a-z])(?=\/|$)(.*)$/i.exec(p);
  if (drive) return `${drive[1].toUpperCase()}:${(drive[2] || "\\").replace(/\//g, "\\")}`;
  return `\\\\wsl.localhost\\${wslInfo().distro}${p.replace(/\//g, "\\")}`;
}

/** The reverse of toWindowsPath, for handing a path to something inside WSL. */
export function toWslPath(p: string): string {
  if (!viaWsl) return p;
  const drive = /^([a-z]):[\\/]?(.*)$/i.exec(p);
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`.replace(/\/$/, "") || "/";
  const unc = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+(.*)$/i.exec(p);
  if (unc) return unc[1].replace(/\\/g, "/") || "/";
  return p;
}

/** The home the user's agents and shell see: the WSL home on Windows. */
export function homeDir(): string {
  return viaWsl ? toWindowsPath(wslInfo().home) : os.homedir();
}

/** Expands a leading "~", and on Windows also accepts Linux paths. */
export function expandHome(p: string): string {
  const expanded = p.startsWith("~") ? path.join(homeDir(), p.slice(1)) : p;
  return toWindowsPath(expanded);
}

/** A command line run through the user's login shell, so PATH and profile apply. */
export function loginShell(command: string, cwd?: string): [file: string, args: string[]] {
  if (!viaWsl) return [process.env.SHELL ?? "/bin/zsh", ["-lc", command]];
  // -i as well: a stock .bashrc returns early unless interactive, and that is
  // usually where PATH is built.
  return ["wsl.exe", [...wslTarget(cwd), "-e", "bash", "-lic", command]];
}

/** Runs a binary directly, inside WSL on Windows. Arguments pass through
 *  untouched: wsl.exe -e skips the shell, so JSON and newlines survive. */
export function agentProcess(bin: string, args: string[], cwd: string): [file: string, args: string[]] {
  return viaWsl ? ["wsl.exe", [...wslTarget(cwd), "-e", bin, ...args]] : [bin, args];
}

function wslTarget(cwd?: string): string[] {
  return ["-d", wslInfo().distro, ...(cwd ? ["--cd", toWslPath(cwd)] : [])];
}

/** The pty spawn for an interactive terminal, optionally running a command first. */
export function terminalProcess(command: string | undefined, cwd: string): { shell: string; args: string[] } {
  if (!viaWsl) {
    const shell = process.env.SHELL ?? "/bin/zsh";
    return { shell, args: command ? ["-l", "-i", "-c", `${command}; exec ${shell} -l`] : ["-l"] };
  }
  return {
    shell: "wsl.exe",
    args: [...wslTarget(cwd), "-e", "bash", "-l", ...(command ? ["-i", "-c", `${command}; exec bash -l`] : [])],
  };
}

/** Env vars Deck sets for its terminals, forwarded into WSL by name. */
export function forwardToWsl(env: Record<string, string>, names: string[]): Record<string, string> {
  if (!viaWsl) return env;
  const existing = env.WSLENV ? env.WSLENV.split(":") : [];
  return { ...env, WSLENV: [...existing, ...names.map((name) => `${name}/u`)].join(":") };
}
