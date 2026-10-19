import fs from "node:fs/promises";
import { openDb } from "./db.js";
import { listSessions, type AgentSession } from "./sessions.js";
import { addStats, claudeStats, codexStats, type SessionStats } from "./tabStats.js";
import type { RememberedTab } from "../shared/settings.js";

// Every tab deck has opened, kept after it closes, the way a browser keeps its
// history. A row is one terminal: a resumed tab is a new terminal and so a new
// visit, which is also how a browser counts a page loaded twice.

export interface HistoryEntry {
  id: string;
  workspace: string | null;
  layer: string | null;
  group: string | null;
  cwd: string | null;
  agent: string | null;
  title: string | null;
  /** Agent sessions that ran in the tab, oldest first; the last is what a reopen resumes. */
  sessionIds: string[];
  openedAt: number;
  closedAt: number | null;
  /** Time the tab was the one in front, in a focused window. */
  activeMs: number;
  /** What the agent said the session was about, or its first prompt. */
  objective: string | null;
  stats: SessionStats | null;
}

interface Row {
  term_id: string;
  workspace: string | null;
  layer: string | null;
  group_id: string | null;
  cwd: string | null;
  agent: string | null;
  title: string | null;
  session_ids: string;
  opened_at: number;
  closed_at: number | null;
  last_seen: number;
  active_ms: number;
}

export function recordOpen(term: { id: string; workspace?: string; layer?: string; group?: string; cwd?: string; agent?: string; sessionId?: string }): void {
  const now = Date.now();
  openDb().prepare(`INSERT OR IGNORE INTO tab_history (term_id, workspace, layer, group_id, cwd, agent, session_ids, opened_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(term.id, term.workspace ?? null, term.layer ?? null, term.group ?? null, term.cwd ?? null, term.agent ?? null, JSON.stringify(term.sessionId ? [term.sessionId] : []), now, now);
}

export function recordClose(termId: string): void {
  if (focused?.id === termId) setFocus(null);
  openDb().prepare("UPDATE tab_history SET closed_at = ?, last_seen = ? WHERE term_id = ? AND closed_at IS NULL").run(Date.now(), Date.now(), termId);
}

/** Terminals that died with the last quit never reported their close; they
 *  closed some time after they were last seen, and that is the best figure. */
export function closeMissing(liveTermIds: string[]): void {
  const live = new Set(liveTermIds);
  const open = openDb().prepare("SELECT term_id FROM tab_history WHERE closed_at IS NULL").all() as { term_id: string }[];
  const close = openDb().prepare("UPDATE tab_history SET closed_at = last_seen WHERE term_id = ?");
  for (const { term_id } of open) if (!live.has(term_id)) close.run(term_id);
}

/** The window writes its tab list down on every change; that is where a tab's
 *  name, layer and group come from. */
export function noteTabs(workspace: string, tabs: RememberedTab[]): void {
  const update = openDb().prepare(`UPDATE tab_history SET title = ?, layer = ?, group_id = ?, cwd = COALESCE(?, cwd), workspace = ?, last_seen = ?
    WHERE term_id = ? AND closed_at IS NULL`);
  const now = Date.now();
  openDb().transaction(() => {
    for (const tab of tabs) update.run(tab.customTitle || tab.title, tab.layer, tab.group ?? null, tab.cwd ?? null, workspace, now, tab.id);
  })();
}

/** Remembers which agent sessions ran in each tab, since a session row lets go
 *  of its terminal once the terminal is gone. */
export function noteSessions(sessions: AgentSession[]): void {
  const db = openDb();
  const read = db.prepare("SELECT session_ids FROM tab_history WHERE term_id = ?");
  const write = db.prepare("UPDATE tab_history SET session_ids = ?, agent = COALESCE(agent, ?) WHERE term_id = ?");
  db.transaction(() => {
    for (const session of sessions) {
      if (!session.term_id || session.session_id.startsWith("pending:")) continue;
      const row = read.get(session.term_id) as { session_ids: string } | undefined;
      if (!row) continue;
      const ids: string[] = JSON.parse(row.session_ids);
      if (!ids.includes(session.session_id)) write.run(JSON.stringify([...ids, session.session_id]), session.agent, session.term_id);
    }
  })();
}

// Active time is counted for one tab at a time: the one in front of whichever
// window last had focus. A blur stops the clock.
let focused: { id: string; since: number } | undefined;
export function setFocus(termId: string | null): void {
  const now = Date.now();
  if (focused && focused.id !== termId) {
    openDb().prepare("UPDATE tab_history SET active_ms = active_ms + ?, last_seen = ? WHERE term_id = ?").run(now - focused.since, now, focused.id);
  }
  if (!termId) { focused = undefined; return; }
  if (focused?.id !== termId) focused = { id: termId, since: now };
}

const statsCache = new Map<string, { mtimeMs: number; size: number; stats: SessionStats }>();
async function transcriptStats(session: AgentSession): Promise<SessionStats | null> {
  const file = session.transcript_path;
  if (!file) return null;
  try {
    const stat = await fs.stat(file);
    const cached = statsCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.stats;
    const text = await fs.readFile(file, "utf8");
    const stats = session.agent === "codex" ? codexStats(text) : claudeStats(text);
    statsCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, stats });
    return stats;
  } catch {
    return null;
  }
}

export async function listHistory(limit = 500): Promise<HistoryEntry[]> {
  const rows = openDb().prepare("SELECT * FROM tab_history ORDER BY COALESCE(closed_at, last_seen) DESC LIMIT ?").all(limit) as Row[];
  const sessions = new Map(listSessions(5000).map((session) => [session.session_id, session]));
  const now = Date.now();
  return Promise.all(rows.map(async (row): Promise<HistoryEntry> => {
    const sessionIds: string[] = JSON.parse(row.session_ids);
    const ran = sessionIds.map((id) => sessions.get(id)).filter((session): session is AgentSession => Boolean(session));
    const parts = (await Promise.all(ran.map(transcriptStats))).filter((stats): stats is SessionStats => Boolean(stats));
    const stats = addStats(parts);
    const live = focused?.id === row.term_id ? now - focused.since : 0;
    return {
      id: row.term_id,
      workspace: row.workspace,
      layer: row.layer,
      group: row.group_id,
      cwd: row.cwd,
      agent: row.agent,
      title: row.title,
      sessionIds,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      activeMs: row.active_ms + live,
      objective: [...ran].reverse().find((session) => session.title)?.title ?? stats?.firstPrompt ?? null,
      stats,
    };
  }));
}

export function markReopened(termId: string): void {
  openDb().prepare("UPDATE tab_history SET reopened = 1 WHERE term_id = ?").run(termId);
}

/** Forgets a visit, or the whole history with no id. */
export function forgetHistory(termId?: string): void {
  if (termId) openDb().prepare("DELETE FROM tab_history WHERE term_id = ? AND closed_at IS NOT NULL").run(termId);
  else openDb().prepare("DELETE FROM tab_history WHERE closed_at IS NOT NULL").run();
}

/** The closed tab a reopen brings back: the latest not already reopened, so
 *  pressing it again walks further back as a browser's does. */
export function takeLastClosed(workspace: string): HistoryEntry | undefined {
  const row = openDb().prepare(`SELECT * FROM tab_history WHERE closed_at IS NOT NULL AND reopened = 0 AND (workspace = ? OR workspace IS NULL)
    ORDER BY closed_at DESC LIMIT 1`).get(workspace) as Row | undefined;
  if (!row) return undefined;
  markReopened(row.term_id);
  return {
    id: row.term_id, workspace: row.workspace, layer: row.layer, group: row.group_id, cwd: row.cwd, agent: row.agent, title: row.title,
    sessionIds: JSON.parse(row.session_ids), openedAt: row.opened_at, closedAt: row.closed_at, activeMs: row.active_ms, objective: null, stats: null,
  };
}
