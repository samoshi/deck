// Keep first: names the channel before anything reads userData.
import "./devChannel.js";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { app } from "electron";
import { bootChoice, entryOf, offSwitch, readState, rollback, writeState } from "./liveState.js";

// The app's entry. It runs the installed build, or the copy of a source
// checkout that ⌘⇧R last switched to (liveState.ts). This file is always the
// installed one, so the watchdog below is not code a broken copy can break.

const TRIAL_MS = 45_000;
const userData = app.getPath("userData");

function fallBack(reason: string): void {
  writeState(userData, rollback(readState(userData), reason));
  // exit, not quit: will-quit would shut the pty host down and every terminal with it.
  app.relaunch();
  app.exit(0);
}

const choice = app.isPackaged && !fs.existsSync(offSwitch(userData)) ? bootChoice(readState(userData), fs.existsSync) : undefined;
if (choice) writeState(userData, choice.state);
const run = choice?.run;

if (run) {
  process.env.DECK_LIVE_BUILD = run.id;
  if (choice.state.trial?.id === run.id) {
    void app.whenReady().then(() => setTimeout(() => {
      const state = readState(userData);
      if (state.trial?.id === run.id) fallBack(`did not report ready within ${TRIAL_MS / 1000} seconds`);
    }, TRIAL_MS));
  }
  import(pathToFileURL(entryOf(run)).href).catch((err: unknown) => fallBack(`failed to load: ${err instanceof Error ? err.message : String(err)}`));
} else {
  void import("./index.js");
}
