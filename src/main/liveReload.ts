import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { app, BrowserWindow, dialog, ipcMain, Notification } from "electron";
import { openDb } from "./db.js";
import { activate, liveDir, markHealthy, prunable, readState, rollback, writeState, type LiveBuild } from "./liveState.js";
import { getSettings } from "./settings.js";

// ⌘⇧R: build the live source checkout and run it in this deck, keeping the
// tabs, data and running terminals. Only the menu item calls this; nothing a
// terminal can reach (IPC, the local server, hooks) does, so an agent working
// on deck can build and test all it likes without changing the deck it runs in.

const exec = promisify(execFile);
const RENDERER_TRIAL_MS = 20_000;
const BACKUPS_KEPT = 5;

const userData = () => app.getPath("userData");
/** The out/ directory of the code this process runs. */
const runningOut = path.join(import.meta.dirname, "..");
/** Copy this process runs; empty for the installed build. */
const runningId = process.env.DECK_LIVE_BUILD ?? "";

let rendererDir = path.join(runningOut, "renderer");
/** Copy whose UI the windows show, which a UI-only reload moves past runningId. */
let currentId = runningId;
let rendererTrial: { id: string; timer: NodeJS.Timeout } | undefined;
let rebuilding = false;
let changed = () => {};

/** Called when the build the windows show changes, so the menu can say which. */
export function onLiveChanged(cb: () => void): void {
  changed = cb;
}

export const rendererIndex = () => path.join(rendererDir, "index.html");

export function liveStatus(): { running?: LiveBuild; rebuilding: boolean } {
  const state = readState(userData());
  return { running: currentId && state.active?.id === currentId ? state.active : undefined, rebuilding };
}

export function startLiveReload(): void {
  ipcMain.on("app:ready", onRendererReady);
  const state = readState(userData());
  if (state.failed) {
    writeState(userData(), { ...state, failed: undefined });
    void dialog.showMessageBox({
      type: "warning",
      message: "Deck went back to an earlier build",
      detail: `The build of ${state.failed.commit} ${state.failed.reason}, so Deck is running ${state.active ? state.active.commit : "the installed version"} instead. Your terminals were not touched.`,
    });
  }
}

function onRendererReady(): void {
  const id = rendererTrial?.id ?? currentId;
  const state = readState(userData());
  if (!id || state.trial?.id !== id) return;
  writeState(userData(), markHealthy(state, id));
  if (rendererTrial) clearTimeout(rendererTrial.timer);
  rendererTrial = undefined;
  changed();
  notify("Deck reloaded", `Running ${state.active?.commit} from ${getSettings().liveSource}.`);
  void prune();
}

/** Stops running copies and restarts on the installed build. */
export function useInstalled(): void {
  const state = readState(userData());
  writeState(userData(), { ...state, active: undefined, trial: undefined });
  restart();
}

export async function rebuildAndReload(): Promise<void> {
  if (!app.isPackaged) return void dialog.showMessageBox({ message: "Deck Dev reloads as you edit", detail: "Rebuild and Reload is for the installed Deck." });
  if (rebuilding) return notify("Already rebuilding", "Deck reloads when the current build finishes.");
  const source = getSettings().liveSource?.trim();
  if (!source) return void dialog.showMessageBox({ message: "No live source set", detail: "Set the folder of a deck checkout under Settings → General → Live source, then press ⌘⇧R again." });
  const root = source.startsWith("~") ? path.join(os.homedir(), source.slice(1)) : source;
  rebuilding = true;
  try {
    const electron = readJson(path.join(root, "node_modules", "electron", "package.json"))?.version;
    if (electron !== process.versions.electron) {
      throw new Error(`The source has Electron ${electron ?? "not installed"} and this Deck runs ${process.versions.electron}, so its native modules would not load here. Install Deck from the source once with npm run install:app.`);
    }
    notify("Rebuilding Deck", `Typecheck, tests and build in ${source}.`);
    await shell(root, "npm run typecheck && npm test && npx electron-vite build");
    const build = await copyBuild(root);
    if (await sameCode(path.join(build.dir, "out"), runningOut, ["main", "preload"])) swapRenderer(build);
    else await restartInto(build);
  } catch (err) {
    void dialog.showMessageBox({ type: "error", message: "Deck did not reload", detail: `Nothing changed in the running Deck.\n\n${err instanceof Error ? err.message : String(err)}` });
  } finally {
    rebuilding = false;
  }
}

async function shell(cwd: string, command: string): Promise<void> {
  // A login shell finds npm the way a terminal does; ELECTRON_* would make the
  // build's own Electron runs behave like this app.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("ELECTRON_") && key !== "DECK_LIVE_BUILD"));
  try {
    await exec(process.env.SHELL ?? "/bin/zsh", ["-lc", command], { cwd, env, timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const { stdout = "", stderr = "" } = err as { stdout?: string; stderr?: string };
    const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-30).join("\n");
    throw new Error(`Checks or build failed:\n\n${tail}`);
  }
}

/** A frozen copy of the source's build, so later builds there leave it alone. */
async function copyBuild(root: string): Promise<LiveBuild> {
  const { stdout: head } = await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).catch(() => ({ stdout: "unknown" }));
  const { stdout: status } = await exec("git", ["status", "--porcelain"], { cwd: root }).catch(() => ({ stdout: "" }));
  const commit = `${head.trim()}${status.trim() ? "+dirty" : ""}`;
  const builtAt = Date.now();
  const id = `${builtAt.toString(36)}-${commit.replace(/[^\w-]/g, "_")}`;
  const dir = path.join(liveDir(userData()), "builds", id);
  fs.mkdirSync(dir, { recursive: true });
  try {
    // -c clones on APFS: no extra disk until a file changes.
    for (const item of ["out", "node_modules", "resources"]) await exec("cp", ["-cR", path.join(root, item), path.join(dir, item)]);
    fs.copyFileSync(path.join(root, "package.json"), path.join(dir, "package.json"));
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  const build: LiveBuild = { id, dir, commit, builtAt };
  fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify(build));
  return build;
}

async function sameCode(a: string, b: string, parts: string[]): Promise<boolean> {
  for (const part of parts) if (digest(path.join(a, part)) !== digest(path.join(b, part))) return false;
  return true;
}

function digest(dir: string): string {
  const hash = createHash("sha256");
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else hash.update(path.relative(dir, full)).update(fs.readFileSync(full));
    }
  };
  try { walk(dir); } catch { return "missing"; }
  return hash.digest("hex");
}

/** Only the UI changed: load it into the open windows, and go back if it never reports ready. */
function swapRenderer(build: LiveBuild): void {
  writeState(userData(), activate(readState(userData()), build));
  const previous = { dir: rendererDir, id: currentId };
  rendererDir = path.join(build.dir, "out", "renderer");
  currentId = build.id;
  rendererTrial = {
    id: build.id,
    timer: setTimeout(() => {
      writeState(userData(), rollback(readState(userData()), "did not report ready"));
      rendererDir = previous.dir;
      currentId = previous.id;
      rendererTrial = undefined;
      changed();
      reloadWindows();
      void dialog.showMessageBox({ type: "warning", message: "Deck went back to the previous UI", detail: `The UI built from ${build.commit} did not report ready within ${RENDERER_TRIAL_MS / 1000} seconds.` });
    }, RENDERER_TRIAL_MS),
  };
  reloadWindows();
}

function reloadWindows(): void {
  for (const window of BrowserWindow.getAllWindows()) void window.loadFile(rendererIndex());
}

/** Main or preload changed: back up the database and restart on the copy. */
async function restartInto(build: LiveBuild): Promise<void> {
  await backupDb();
  writeState(userData(), activate(readState(userData()), build));
  notify("Restarting Deck", `Starting ${build.commit}. Terminals keep running.`);
  restart();
}

function restart(): void {
  // exit, not quit: will-quit shuts the pty host down, and every terminal with it.
  app.relaunch();
  app.exit(0);
}

async function backupDb(): Promise<void> {
  const dir = path.join(liveDir(userData()), "backups");
  fs.mkdirSync(dir, { recursive: true });
  await openDb().backup(path.join(dir, `deck-${new Date().toISOString().replace(/[:.]/g, "-")}.db`));
  const old = fs.readdirSync(dir).filter((name) => name.endsWith(".db")).sort().slice(0, -BACKUPS_KEPT);
  for (const name of old) fs.rmSync(path.join(dir, name), { force: true });
}

async function prune(): Promise<void> {
  const root = path.join(liveDir(userData()), "builds");
  const builds = (fs.existsSync(root) ? fs.readdirSync(root) : [])
    .map((name) => readJson(path.join(root, name, "build.json")) as LiveBuild | undefined)
    .filter((build): build is LiveBuild => Boolean(build));
  for (const build of prunable(builds, readState(userData()))) await fs.promises.rm(build.dir, { recursive: true, force: true });
}

function readJson(file: string): { version?: string } & Record<string, unknown> | undefined {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

