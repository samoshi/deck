// Installs the built app into /Applications, so the Deck you use day to day is
// this checkout. Quits a running Deck first and reopens it afterwards; the
// dev channel (Deck Dev) is untouched and keeps its own data.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, globSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.dirname(import.meta.dirname);
const [built] = globSync("dist/mac-*/Deck.app", { cwd: root }).map((p) => path.join(root, p));
if (!built) {
  console.error("No built app found. Run `npm run build && npx electron-builder --mac dir` first.");
  process.exit(1);
}

const target = "/Applications/Deck.app";
const run = (cmd) => execSync(cmd, { stdio: "inherit" });

// pgrep never matches a bundle LaunchServices started, so asking it whether
// Deck is up reports "no" and the swap deletes the app out from under itself.
const deckIsRunning = () =>
  execFileSync("osascript", ["-e", 'application "Deck" is running']).toString().trim() === "true";

// Installing from a terminal inside the app being replaced kills this very
// shell halfway through, leaving no app in /Applications at all.
const ancestry = () => {
  const lines = [];
  for (let pid = process.ppid, depth = 0; pid > 1 && depth < 12; depth++) {
    const [parent, command] = execSync(`ps -o ppid=,args= -p ${pid}`).toString().trim().split(/\s+(.*)/);
    lines.push(command ?? "");
    pid = Number(parent);
  }
  return lines;
};
if (ancestry().some((command) => command.startsWith(`${target}/Contents/MacOS/`))) {
  console.error(`Refusing to replace ${target} from a terminal running inside it.`);
  console.error("Quit Deck and run this again from Terminal.app, or run it from the Deck Dev build.");
  process.exit(1);
}

const running = deckIsRunning();
if (running) {
  execFileSync("osascript", ["-e", 'tell application "Deck" to quit']);
  // Give it a moment to release its port and PTY socket before the swap.
  for (let waited = 0; waited < 20 && deckIsRunning(); waited++) execSync("sleep 0.5");
}

if (existsSync(target)) rmSync(target, { recursive: true, force: true });
run(`cp -R '${built}' /Applications/`);
// Editing or copying the bundle invalidates any signature; unsigned binaries
// won't launch on Apple Silicon, and the quarantine flag would prompt.
run(`codesign --force --deep --sign - '${target}'`);
run(`xattr -dr com.apple.quarantine '${target}' || true`);
console.log(`installed ${path.relative(root, built)} to ${target}`);

if (running) run(`open -a '${target}'`);
