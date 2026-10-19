import { useEffect, useMemo, useState } from "react";
import type { HistoryEntry } from "../../../main/history.js";
import type { Agent } from "../../../shared/agents.js";
import { agentLabels } from "../../../shared/agents.js";
import { dayLabel, formatDuration, formatTokens, formatUsd } from "../../../shared/historyFormat.js";
import { Icon } from "../board/icons.js";
import { shortPath } from "../lib/useGitSummary.js";
import { useSettings } from "../lib/useSettings.js";
import { useTabs } from "../store.js";
import { SessionIcon } from "./SessionIcon.js";

// A browser's history for tabs, with what each one cost in the way Tower's
// spend view shows a run: time in front, time in the background, time the
// agent spent working, tokens and an estimated price.

type Filter = "all" | "agents" | "closed";

const totalTokens = (entry: HistoryEntry): number => {
  const tokens = entry.stats?.tokens;
  return tokens ? tokens.input + tokens.output + tokens.cacheWrite + tokens.cacheRead : 0;
};

function Figure({ value, label, title }: { value: string; label: string; title?: string }) {
  return <div title={title} className="flex min-w-[96px] flex-col rounded-lg border border-edge2 bg-card px-3 py-2">
    <b className="text-[15px] font-semibold text-soft">{value || "–"}</b>
    <span className="text-[10px] text-dim">{label}</span>
  </div>;
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  if (!value) return null;
  return <span title={title} className="whitespace-nowrap"><span className="text-dim">{label} </span>{value}</span>;
}

export function HistoryView({ onOpened }: { onOpened: () => void }) {
  const { allTabs, focusTab, newTab } = useTabs();
  const settings = useSettings();
  const [entries, setEntries] = useState<HistoryEntry[]>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(Date.now());
  const load = () => void window.deck.history.list().then((list) => { setEntries(list); setNow(Date.now()); });
  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, []);

  const openIds = new Set(allTabs.map((tab) => tab.termId));
  const layerName = (id: string | null) => settings?.layers.find((layer) => layer.id === id)?.name;
  const title = (entry: HistoryEntry) => entry.objective || entry.title || entry.cwd?.split("/").pop() || "Terminal";
  const shown = useMemo(() => (entries ?? []).filter((entry) => {
    if (filter === "agents" && !entry.agent) return false;
    if (filter === "closed" && !entry.closedAt) return false;
    const text = [entry.objective, entry.title, entry.cwd, entry.agent].join(" ").toLowerCase();
    return text.includes(query.trim().toLowerCase());
  }), [entries, filter, query]);

  const today = (entries ?? []).filter((entry) => dayLabel(entry.closedAt ?? now, now) === "Today" || !entry.closedAt);
  const sum = (pick: (entry: HistoryEntry) => number | null | undefined) => today.reduce((total, entry) => total + (pick(entry) ?? 0), 0);
  const unpriced = today.filter((entry) => entry.stats && entry.stats.costUsd === null).length;

  const open = async (entry: HistoryEntry) => {
    if (openIds.has(entry.id)) { focusTab(entry.id); onOpened(); return; }
    window.deck.history.reopened(entry.id);
    await newTab({
      agent: (entry.agent ?? undefined) as Agent | undefined,
      cwd: entry.cwd ?? undefined,
      sessionId: entry.sessionIds.at(-1),
      layer: entry.layer && settings?.layers.some((layer) => layer.id === entry.layer) ? entry.layer : undefined,
      group: entry.group ?? undefined,
    });
    onOpened();
  };

  const days: { label: string; rows: HistoryEntry[] }[] = [];
  for (const entry of shown) {
    const label = dayLabel(entry.closedAt ?? now, now);
    const day = days.at(-1)?.label === label ? days.at(-1)! : (days.push({ label, rows: [] }), days.at(-1)!);
    day.rows.push(entry);
  }
  const recentlyClosed = (entries ?? []).filter((entry) => entry.closedAt).slice(0, 6);

  return <div className="flex min-h-0 flex-1 flex-col font-sans">
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge px-5">
      <Icon name="history" size={14} className="text-mut" />
      <h1 className="text-[13px] font-semibold text-soft">History</h1>
      <div className="ml-4 flex min-w-0 flex-1 items-center gap-2 rounded-md border border-edge2 bg-card px-2 py-1">
        <Icon name="search" size={12} className="text-mut" />
        <input aria-label="Search history" placeholder="Search history…" value={query} onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-soft outline-none placeholder:text-dim" />
      </div>
      <div role="group" aria-label="Filter history" className="flex items-center gap-1 text-[11px]">
        {(["all", "agents", "closed"] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}
          className={`rounded px-2 py-1 ${filter === value ? "bg-card2 text-soft" : "text-mut hover:text-soft"}`}>{value === "all" ? "All" : value === "agents" ? "Agents" : "Closed"}</button>)}
      </div>
      <button onClick={() => { if (window.confirm("Clear the history of closed tabs? Open tabs stay.")) void window.deck.history.forget().then(load); }}
        className="text-[11px] text-mut hover:text-red">Clear</button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
      <section aria-label="Today" className="flex flex-wrap gap-2 pt-4">
        <Figure value={String(today.length)} label="tabs today" />
        <Figure value={formatDuration(sum((entry) => entry.activeMs))} label="active" title="Time a tab was in front of a focused window" />
        <Figure value={formatDuration(sum((entry) => entry.stats?.agentMs))} label="agent working" title="Time from each prompt to the end of its turn" />
        <Figure value={formatTokens(sum(totalTokens))} label="tokens" title="Input, output and cache tokens across today's agent sessions" />
        <Figure value={formatUsd(sum((entry) => entry.stats?.costUsd))} label="estimated spend"
          title={`Estimated from list prices${unpriced ? `; ${unpriced} session${unpriced === 1 ? "" : "s"} without a known price left out` : ""}`} />
      </section>

      {!query && filter === "all" && recentlyClosed.length > 0 && <section aria-label="Recently closed" className="mt-5">
        <h2 className="mb-1.5 text-[10px] tracking-widest text-dim">RECENTLY CLOSED <span className="ml-1 normal-case tracking-normal">⌘⇧T reopens the latest</span></h2>
        <div className="flex flex-wrap gap-1.5">
          {recentlyClosed.map((entry) => <button key={entry.id} onClick={() => void open(entry)} title={entry.cwd ?? undefined}
            className="flex max-w-[16rem] items-center gap-1.5 rounded-full border border-edge2 px-2.5 py-1 text-[11px] text-body hover:border-edge3 hover:bg-card">
            <Icon name={entry.agent ? "sparkle" : "terminal"} size={11} className="shrink-0 text-mut" /><span className="truncate">{title(entry)}</span>
          </button>)}
        </div>
      </section>}

      {entries === undefined && <div className="pt-6 text-xs text-dim">Loading history…</div>}
      {entries && !shown.length && <div className="pt-6 text-xs text-dim">{entries.length ? "Nothing matches." : "Tabs you open will be listed here."}</div>}
      {days.map((day) => <section key={day.label} aria-label={day.label} className="mt-5">
        <h2 className="mb-1 text-[10px] tracking-widest text-dim">{day.label.toUpperCase()}</h2>
        {day.rows.map((entry) => {
          const isOpen = openIds.has(entry.id) && !entry.closedAt;
          const lifetime = (entry.closedAt ?? now) - entry.openedAt;
          const background = Math.max(0, lifetime - entry.activeMs);
          const stats = entry.stats;
          const resumable = Boolean(entry.agent && entry.sessionIds.length);
          const layer = layerName(entry.layer);
          return <div key={entry.id} className="group flex items-center gap-3 rounded-lg border border-transparent px-2 py-2 hover:border-edge2 hover:bg-card">
            <span className="w-10 shrink-0 text-right text-[10px] text-dim">{new Date(entry.openedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
            <SessionIcon agent={(entry.agent ?? undefined) as Agent | undefined} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[12px] text-soft" title={entry.objective ?? undefined}>{title(entry)}</span>
                {isOpen && <span className="shrink-0 rounded-full bg-green/15 px-1.5 text-[9px] text-green">open</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-mut">
                <span className="truncate">{shortPath(entry.cwd ?? undefined)}{layer ? ` · ${layer}` : ""}{entry.agent ? ` · ${agentLabels[entry.agent as Agent] ?? entry.agent}` : ""}</span>
                <Stat label="open" value={formatDuration(lifetime)} />
                <Stat label="active" value={formatDuration(entry.activeMs)} />
                <Stat label="background" value={formatDuration(background)} />
                <Stat label="agent" value={formatDuration(stats?.agentMs)} title="Time from each prompt to the end of its turn" />
                {stats && <Stat label="tokens" value={formatTokens(totalTokens(entry))}
                  title={`${stats.tokens.input} in · ${stats.tokens.output} out · ${stats.tokens.cacheWrite} cache write · ${stats.tokens.cacheRead} cache read${stats.model ? `\n${stats.model}` : ""}`} />}
                {stats && <Stat label="cost" value={stats.costUsd === null ? "unknown" : `~${formatUsd(stats.costUsd)}`} title="Estimated from list prices" />}
              </div>
            </div>
            <button onClick={() => void open(entry)} className="shrink-0 rounded-md border border-edge2 px-2.5 py-1 text-[11px] text-soft opacity-0 hover:border-edge3 group-hover:opacity-100 focus:opacity-100">
              {isOpen ? "Go to tab" : resumable ? "Resume session" : "Reopen shell"}
            </button>
          </div>;
        })}
      </section>)}
    </div>
  </div>;
}
