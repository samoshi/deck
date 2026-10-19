import fs from "node:fs";
import path from "node:path";

// Which build of deck's own code runs: the one installed in the app bundle, or
// a checked copy of a source checkout that ⌘⇧R built (liveReload.ts). A new
// copy runs on trial until its window reports ready; a copy that never does is
// replaced by the last one that did, so a broken build costs a restart, not
// the app. Pure apart from the file reads and writes, so boot.ts can use it
// before anything else loads.

export interface LiveBuild {
  id: string;
  /** The copy's root, holding out/, node_modules/ and package.json. */
  dir: string;
  /** Short commit of the source, "+dirty" when it had uncommitted changes. */
  commit: string;
  builtAt: number;
}

export interface LiveState {
  /** The copy to run; none means the installed build. */
  active?: LiveBuild;
  /** The newest copy that came up and reported ready. */
  lastGood?: LiveBuild;
  /** Set while `active` has not yet reported ready; attempts counts starts. */
  trial?: { id: string; attempts: number };
  /** The last copy rolled back, kept until the user has been told. */
  failed?: { commit: string; reason: string; at: number };
}

export const liveDir = (userData: string) => path.join(userData, "live");
const stateFile = (userData: string) => path.join(liveDir(userData), "state.json");
/** Present, the installed build runs whatever the state says. */
export const offSwitch = (userData: string) => path.join(liveDir(userData), "off");

export function readState(userData: string): LiveState {
  try { return JSON.parse(fs.readFileSync(stateFile(userData), "utf8")) as LiveState; } catch { return {}; }
}

export function writeState(userData: string, state: LiveState): void {
  fs.mkdirSync(liveDir(userData), { recursive: true });
  const temp = `${stateFile(userData)}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, stateFile(userData));
}

export const entryOf = (build: LiveBuild) => path.join(build.dir, "out", "main", "index.js");

/** The build a starting deck runs, and the state to save before running it. */
export function bootChoice(state: LiveState, exists: (file: string) => boolean): { run?: LiveBuild; state: LiveState } {
  let next = { ...state };
  // A trial that already had its start and never reported ready crashed or hung.
  if (next.active && next.trial?.id === next.active.id && next.trial.attempts >= 1) {
    next = rollback(next, "did not start");
  }
  if (next.active && !exists(entryOf(next.active))) next = rollback(next, "its files are gone");
  if (next.active && next.trial?.id === next.active.id) next.trial = { ...next.trial, attempts: next.trial.attempts + 1 };
  return { run: next.active, state: next };
}

/** Runs `build` next, on trial. */
export function activate(state: LiveState, build: LiveBuild): LiveState {
  return { ...state, active: build, trial: { id: build.id, attempts: 0 } };
}

export function markHealthy(state: LiveState, id: string): LiveState {
  if (state.active?.id !== id || state.trial?.id !== id) return state;
  return { ...state, lastGood: state.active, trial: undefined };
}

/** Falls back from the active copy to the last good one, or the installed build. */
export function rollback(state: LiveState, reason: string): LiveState {
  const failed = state.active ? { commit: state.active.commit, reason, at: Date.now() } : state.failed;
  const back = state.lastGood && state.lastGood.id !== state.active?.id ? state.lastGood : undefined;
  return { ...state, active: back, trial: undefined, failed };
}

/** Copies no longer worth keeping: all but the active, the last good and the newest `keep`. */
export function prunable(builds: LiveBuild[], state: LiveState, keep = 3): LiveBuild[] {
  const held = new Set([state.active?.id, state.lastGood?.id]);
  const newest = new Set([...builds].sort((a, b) => b.builtAt - a.builtAt).slice(0, keep).map((build) => build.id));
  return builds.filter((build) => !held.has(build.id) && !newest.has(build.id));
}
