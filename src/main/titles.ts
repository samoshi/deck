import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { BrowserWindow } from "electron";
import { openDb } from "./db.js";

const exec = promisify(execFile);

// A first prompt makes a poor tab label: it is a paragraph cut off at whatever
// width the sidebar has. A small model names the work (shared/topic.ts) in a
// short and a longer form, and the sidebar shows whichever fits.

export interface ShortTitle {
  /** One or two words. */
  short: string;
  /** Three to five words. */
  long: string;
}

const PROMPT = `Name the work described below for a sidebar label.
Name the subject: the project, customer, system, ticket or role the work is about, not the action taken (not "brief", "review", "read", "help").
Reuse the user's own words for it, such as names, acronyms and ticket keys, spelled as the user wrote them.
The folder only says where the work runs; use it only when nothing else names the subject.
When several requests are given, the latest ones say most about where the work is now.
Reply with exactly two lines and nothing else:
line 1: one or two words
line 2: three to five words, starting with the subject from line 1
Plain words, no quotes, no trailing punctuation, no emoji.

`;

const queue: { key: string; text: string }[] = [];
const pending = new Set<string>();
let running = false;
let bin: Promise<string> | undefined;

/** The named form of `text`, or undefined while it is being named or when naming failed. */
export function titleFor(key: string, text: string): ShortTitle | undefined {
  const row = openDb().prepare("SELECT short, long, source FROM short_titles WHERE key = ?").get(key) as (ShortTitle & { source: string }) | undefined;
  if (row && row.source === text) return row.short ? { short: row.short, long: row.long } : undefined;
  if (!pending.has(key) && text.trim()) {
    pending.add(key);
    queue.push({ key, text });
    void drain();
  }
  return row?.short ? { short: row.short, long: row.long } : undefined;
}

export function parseTitle(output: string): ShortTitle | undefined {
  const lines = output.split("\n").map((line) => line.replace(/^(line \d:|\d[.):])\s*/i, "").replace(/["'`*]/g, "").trim()).filter(Boolean);
  if (lines.length < 2) return undefined;
  const words = (line: string, max: number) => line.split(/\s+/).slice(0, max).join(" ");
  return { short: words(lines[0], 2), long: words(lines[1], 5) };
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const title = await name(job.text).catch(() => undefined);
      // A failure is stored too, so a prompt that cannot be named is not retried on every change.
      openDb().prepare("INSERT OR REPLACE INTO short_titles (key, source, short, long) VALUES (?, ?, ?, ?)")
        .run(job.key, job.text, title?.short ?? "", title?.long ?? "");
      pending.delete(job.key);
      if (title) for (const window of BrowserWindow.getAllWindows()) window.webContents.send("titles:changed", job.key, title);
    }
  } finally {
    running = false;
  }
}

async function name(text: string): Promise<ShortTitle | undefined> {
  bin ??= exec(process.env.SHELL ?? "/bin/zsh", ["-lc", "command -v claude"], { timeout: 10_000 })
    .then(({ stdout }) => stdout.trim().split("\n").pop() || "claude").catch(() => "claude");
  // No tools, no user settings (so none of the user's hooks fire), and no
  // saved session: this must not show up as a session of its own.
  const { stdout } = await exec(await bin, [
    "-p", PROMPT + text.slice(0, 2000),
    "--system-prompt", "You write short labels.",
    "--model", "haiku",
    "--output-format", "json",
    "--tools", "",
    "--setting-sources", "project",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
  ], { cwd: os.tmpdir(), timeout: 60_000, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CLAUDE"))) });
  const reply = JSON.parse(stdout) as { result?: string; is_error?: boolean };
  return reply.is_error || !reply.result ? undefined : parseTitle(reply.result);
}
