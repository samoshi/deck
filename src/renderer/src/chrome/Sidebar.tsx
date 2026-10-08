import { useEffect, useRef, useState } from "react";
import { agentLabels, type Agent } from "../../../shared/agents.js";
import type { AgentSession } from "../../../main/sessions.js";
import { SessionIcon, statusLabels, statusTones } from "./SessionIcon.js";
import { SessionArchive } from "./SessionArchive.js";
import { WorktreeSweep } from "./WorktreeSweep.js";
import { SessionSweep } from "./SessionSweep.js";
import { useAgentSessions } from "../lib/useSessions.js";
import { shortPath, useGitSummary } from "../lib/useGitSummary.js";
import { useTabs, type TermTab } from "../store.js";
import { Icon, isIconName, type IconName } from "../board/icons.js";
import { useSessionSuggestions } from "./useSessionSuggestions.js";
import { useReviewQueue } from "../lib/reviews.js";
import { useSettings } from "../lib/useSettings.js";
import { formatChord, resolveKeybinds } from "../../../shared/keybinds.js";
import { LayerStrip, colorStyle } from "./LayerStrip.js";
import { layerColors, layerOf, type TabGroup } from "../../../shared/settings.js";
import { useAttentionCount } from "../agents/attention.js";
import { useTips } from "../tips/TipsProvider.js";
import { adoptPane } from "../lib/bus.js";
import type { View } from "../App.js";

/** `indent` is how deep the row sits: 0 ungrouped, 1 in a group, 2 in the
 *  subgroup a split makes. */
function SessionRow({ tab, session, index, indent = 0, groupColor, onGroupWith, onNewGroup, onOpen }: { tab: TermTab; session?: AgentSession; index: number; indent?: number; groupColor?: string; onGroupWith: (dragged: string, target: TermTab) => void; onNewGroup: (termId: string) => void; onOpen: () => void }) {
  const { activeId, requestCloseTab, renameTab, moveTab, moveTabToWorkspace, moveTabToLayer, setTabGroup } = useTabs();
  const { report } = useTips();
  const settings = useSettings();
  const otherWorkspaces = settings?.workspaces.filter((workspace) => workspace.id !== settings.activeWorkspace) ?? [];
  const otherLayers = (settings?.layers ?? []).filter((layer) => layer.id !== settings?.activeLayer);
  const groups = (settings?.groups ?? []).filter((group) => group.layer === settings?.activeLayer);
  // Two groups may share a name under different parents, so a subgroup is
  // offered by its path rather than on its own.
  const groupPath = (group: TabGroup): string => {
    const parent = group.parent ? groups.find((other) => other.id === group.parent) : undefined;
    return parent ? `${parent.name} / ${group.name}` : group.name;
  };
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    window.addEventListener("mousedown", dismiss);
    return () => window.removeEventListener("mousedown", dismiss);
  }, [menu]);
  // Browser rule: a drop along a row's edge reorders, a drop on its middle
  // groups the two tabs. The zone under the cursor drives both the cue and the act.
  const [dropZone, setDropZone] = useState<"before" | "into" | "after">();
  const zoneAt = (event: React.DragEvent): "before" | "into" | "after" => {
    const box = event.currentTarget.getBoundingClientRect();
    const offset = (event.clientY - box.top) / box.height;
    return offset < 0.3 ? "before" : offset > 0.7 ? "after" : "into";
  };
  const [name, setName] = useState("");
  const cwd = session?.cwd || tab.cwd;
  const git = useGitSummary(cwd);
  const agent = session?.agent ?? tab.agent;
  const title = tab.customTitle || session?.title || (tab.title === "shell" ? cwd?.split("/").pop() : tab.title) || "Terminal";
  const active = activeId === tab.termId;
  const waiting = session && ["needs_input", "needs_review"].includes(session.status);
  const tone = session ? statusTones[session.status] : undefined;
  const oscColor = tone ? undefined : tab.tabColor;
  return <div draggable={!renaming} onDragStart={(event) => { event.dataTransfer.setData("text/deck-tab", tab.termId); event.dataTransfer.effectAllowed = "move"; }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("text/deck-tab")) { event.preventDefault(); setDropZone(zoneAt(event)); } }}
    onDragLeave={() => setDropZone(undefined)}
    onDrop={(event) => {
      event.preventDefault();
      const zone = zoneAt(event);
      setDropZone(undefined);
      const id = event.dataTransfer.getData("text/deck-tab");
      if (!id || id === tab.termId) return;
      if (zone === "into") { onGroupWith(id, tab); return; }
      moveTab(id, zone === "before" ? tab.termId : undefined);
      setTabGroup(id, tab.groupId ?? null);
    }}
    style={groupColor ? { boxShadow: `inset 2px 0 0 var(--color-${groupColor})` } : undefined}
    className={`relative border-b px-2 py-2 ${indent === 2 ? "pl-7" : indent === 1 ? "pl-4" : ""} ${dropZone === "before" ? "border-t border-t-accent" : dropZone === "after" ? "border-b-accent" : "border-edge/80"}`}>
    <div role="button" tabIndex={0} aria-label={`${title}${agent ? ` (${agentLabels[agent]})` : ""}${tab.paused ? " (paused)" : ""}`} aria-current={active ? "page" : undefined}
      onClick={() => { report({ action: "tab-click" }); onOpen(); }} onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === "Enter") onOpen(); }}
      onDoubleClick={() => { setName(title); setRenaming(true); }}
      onContextMenu={(event) => { event.preventDefault(); setMenu(true); }}
      className={`group relative flex min-h-[56px] cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 outline-none focus-visible:border-mut ${tab.paused ? "border-dashed border-edge2 hover:border-edge3" : active ? "border-edge3 bg-card2" : "border-transparent hover:bg-card"}`}>
      <span className={tab.paused ? "opacity-40" : undefined}><SessionIcon agent={agent} status={session?.status} color={oscColor} /></span>
      <div className="min-w-0 flex-1">
        {renaming ? <input aria-label="Session name" autoFocus value={name} onChange={(event) => setName(event.target.value)}
          onClick={(event) => event.stopPropagation()} onBlur={() => { renameTab(tab.termId, name); setRenaming(false); }}
          onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") { renameTab(tab.termId, name); setRenaming(false); } if (event.key === "Escape") setRenaming(false); }}
          className="w-full rounded bg-bg px-1 text-xs text-ink outline-none" /> :
          <div className={`truncate text-[12px] ${tab.paused ? "text-mut" : "text-soft"}`} title={title}>{title}</div>}
        <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-mut">
          {git ? <><Icon name="branch" size={10} /><span className="truncate">{git.branch}</span></> : <span className="truncate">{shortPath(cwd)}</span>}
          {agent && <span className="ml-auto shrink-0 text-dim">{agentLabels[agent]}</span>}
        </div>
        {waiting && tone && <div className={`mt-1 text-[10px] ${tone.text}`}>{statusLabels[session.status]}</div>}
      </div>
      <span className="self-start pt-0.5 text-[10px] text-dim group-hover:hidden">{tab.paused ? "paused" : index < 9 ? `⌘${index + 1}` : ""}</span>
      {dropZone === "into" && <div aria-hidden className="pointer-events-none absolute inset-0 rounded-md border-2 border-accent/70 bg-accent/10" />}
      {tab.paused && <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-bg/60 opacity-0 backdrop-blur-[1px] transition-opacity duration-150 group-hover:opacity-100">
        <span className="flex items-center gap-1.5 rounded-full border border-edge3 bg-overlay px-3 py-1 text-[11px] text-soft shadow-lg"><Icon name="play" size={10} />Resume</span>
      </div>}
      <button aria-label={`Close ${title}`} title="Close session" className="hidden self-start text-mut hover:text-ink group-hover:block"
        onClick={(event) => { event.stopPropagation(); report({ action: "close-tab-button" }); requestCloseTab(tab.termId); }}><Icon name="x" size={11} /></button>
    </div>
    {menu && <div ref={menuRef} role="menu" aria-label={`${title} options`} className="absolute left-3 right-3 z-50 mt-1 rounded-lg border border-edge3 bg-overlay p-1 shadow-xl">
      <button className="menu-item" onClick={() => { setMenu(false); setName(title); setRenaming(true); }}>Rename</button>
      {(groups.length > 0 || tab.groupId) && <div className="px-2 pb-0.5 pt-1.5 text-[10px] tracking-widest text-dim">GROUP</div>}
      {groups.filter((group) => group.id !== tab.groupId).map((group) => <button key={group.id} className="menu-item" onClick={() => { setMenu(false); setTabGroup(tab.termId, group.id); }}>Add to {groupPath(group)}</button>)}
      {tab.groupId && <button className="menu-item" onClick={() => { setMenu(false); setTabGroup(tab.termId, null); }}>Remove from group</button>}
      <button className="menu-item" onClick={() => { setMenu(false); onNewGroup(tab.termId); }}>New group with this tab</button>
      {!active && !tab.paused && <button className="menu-item" onClick={() => { setMenu(false); adoptPane({ termId: tab.termId, towards: "right" }); }}>Split beside the current tab</button>}
      {otherLayers.length > 0 && <div className="px-2 pb-0.5 pt-1.5 text-[10px] tracking-widest text-dim">LAYER</div>}
      {otherLayers.map((layer) => <button key={layer.id} className="menu-item" onClick={() => { setMenu(false); moveTabToLayer(tab.termId, layer.id); }}>Move to {layer.name}</button>)}
      {otherWorkspaces.length > 0 && <div className="px-2 pb-0.5 pt-1.5 text-[10px] tracking-widest text-dim">WORKSPACE</div>}
      {otherWorkspaces.map((workspace) => <button key={workspace.id} className="menu-item" onClick={() => { setMenu(false); moveTabToWorkspace(tab.termId, workspace.id); }}>Move to {workspace.name}</button>)}
      <div className="my-1 border-t border-edge2" />
      <button className="menu-item" onClick={() => { setMenu(false); requestCloseTab(tab.termId); }}>Close</button>
    </div>}
  </div>;
}

/** A group's header: its name, how many tabs it holds and, when collapsed, how
 *  many of them want something. Collapsing hides the rows, never the tabs:
 *  they keep running and the number chords still reach them. */
function GroupHeader({ group, count, waiting, nested, onToggle, onChange, onDelete, onClose, onDropTab }: {
  group: TabGroup;
  count: number;
  /** Tabs inside whose agent is waiting on the user. */
  waiting: number;
  /** A subgroup, so the header sits indented under its parent's. */
  nested?: boolean;
  onToggle: () => void;
  onChange: (group: TabGroup) => void;
  onDelete: () => void;
  /** Closes every tab the header counts, the group with them. */
  onClose: () => void;
  onDropTab: (termId: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const [over, setOver] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    window.addEventListener("mousedown", dismiss);
    return () => window.removeEventListener("mousedown", dismiss);
  }, [menu]);
  const rename = () => { onChange({ ...group, name: name.trim() || group.name }); setRenaming(false); };
  return <div className="group relative"
    onDragOver={(event) => { if (event.dataTransfer.types.includes("text/deck-tab")) { event.preventDefault(); setOver(true); } }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => { event.preventDefault(); setOver(false); const termId = event.dataTransfer.getData("text/deck-tab"); if (termId) onDropTab(termId); }}>
    {renaming
      ? <input aria-label="Group name" autoFocus value={name} onChange={(event) => setName(event.target.value)} onBlur={rename}
          onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") rename(); if (event.key === "Escape") setRenaming(false); }}
          className="mx-2 my-1 w-[calc(100%-1rem)] rounded bg-bg px-1.5 py-1 text-[11px] text-ink outline-none" />
      : <button aria-expanded={!group.collapsed} aria-label={`${group.name} group, ${count} tab${count === 1 ? "" : "s"}`} onClick={onToggle} onDoubleClick={() => { setName(group.name); setRenaming(true); }}
          onContextMenu={(event) => { event.preventDefault(); setMenu(true); }}
          style={group.color ? {
            background: `color-mix(in srgb, var(--color-${group.color}) ${over ? 22 : 10}%, transparent)`,
            boxShadow: `inset 2px 0 0 var(--color-${group.color})`,
          } : undefined}
          className={`flex w-full items-center gap-1.5 py-1.5 pr-2 text-left text-[11px] ${nested ? "pl-5" : "pl-2"} ${group.color ? "" : over ? "bg-card2" : "hover:bg-card"}`}>
          <span aria-hidden className="w-2 text-dim">{group.collapsed ? "\u25b8" : "\u25be"}</span>
          <span className="min-w-0 flex-1 truncate text-soft">{group.name}</span>
          {waiting > 0 && group.collapsed && <span aria-label={`${waiting} waiting`} className="rounded-full bg-orange/20 px-1.5 text-[10px] text-orange">{waiting}</span>}
          <span className="text-dim group-hover:invisible">{count}</span>
        </button>}
    {!renaming && <button aria-label={`Close ${group.name} and its ${count} tab${count === 1 ? "" : "s"}`}
      title="Close the group and its tabs" onClick={onClose}
      className="absolute right-2 top-1.5 hidden text-mut hover:text-red group-hover:block"><Icon name="x" size={11} /></button>}
    {menu && <div ref={menuRef} role="menu" aria-label={`${group.name} options`} className="absolute left-3 right-3 z-50 mt-1 rounded-lg border border-edge3 bg-overlay p-1 shadow-xl">
      <button className="menu-item" onClick={() => { setMenu(false); setName(group.name); setRenaming(true); }}>Rename</button>
      <div className="flex gap-1 px-2 py-1.5">
        <button aria-label="No colour" title="No colour" onClick={() => { setMenu(false); onChange({ ...group, color: undefined }); }} className="h-4 w-4 rounded-full border border-edge3" />
        {layerColors.map((color) => <button key={color} aria-label={color} title={color} style={colorStyle(color)}
          onClick={() => { setMenu(false); onChange({ ...group, color }); }}
          className={`h-4 w-4 rounded-full ${group.color === color ? "ring-2 ring-soft" : ""}`} />)}
      </div>
      <div className="my-1 border-t border-edge2" />
      <button className="menu-item" onClick={() => { setMenu(false); onDelete(); }}>{nested ? "Ungroup tabs" : "Ungroup tabs and subgroups"}</button>
      <button className="menu-item text-red" onClick={() => { setMenu(false); onClose(); }}>Close {count} tab{count === 1 ? "" : "s"}</button>
    </div>}
  </div>;
}

const footerViews = ["terminal", "board", "agent", "reviews"] as const;

export function Sidebar({ view, onView }: { view: View; onView: (view: View) => void }) {
  const { tabs, allTabs, newTab, focusTab, closeTab, requestCloseTab, setTabGroup, createGroup, moveTab, moveTabToLayer, resumeTab, reopenTabs, pausedByLayer } = useTabs();
  /** The last group or layer closed, offered back for a few seconds. */
  const [undo, setUndo] = useState<{ label: string; restore: () => Promise<void> }>();
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();
  const [archive, setArchive] = useState(false);
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  const settings = useSettings();
  // Arc-style: a horizontal swipe on the sidebar steps to the next/previous view.
  // A swipe keeps firing momentum events long after the fingers lift, so once a step is
  // taken the sidebar goes deaf for a moment: one view per swipe, never a jump.
  const swipe = useRef({ distance: 0, steppedAt: 0 });
  const onWheel = (event: React.WheelEvent) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    const gesture = swipe.current;
    if (event.timeStamp - gesture.steppedAt < 350) return;
    const sameWay = Math.sign(event.deltaX) === Math.sign(gesture.distance);
    gesture.distance = sameWay ? gesture.distance + event.deltaX : event.deltaX;
    if (Math.abs(gesture.distance) < 60) return;
    const step = Math.sign(gesture.distance);
    gesture.distance = 0;
    gesture.steppedAt = event.timeStamp;
    // The archive is a slot of its own, one step left of the first view: while it
    // is open a swipe back closes it instead of stepping through the views behind.
    if (archive) { if (step > 0) setArchive(false); return; }
    const index = Math.max(0, footerViews.indexOf(view as (typeof footerViews)[number]));
    if (step < 0 && index === 0) { setArchive(true); return; }
    onView(footerViews[Math.min(footerViews.length - 1, Math.max(0, index + step))]);
  };
  const footerIndex = footerViews.indexOf(view as (typeof footerViews)[number]);
  const sessions = useAgentSessions();
  const attention = useAttentionCount();
  const reviews = useReviewQueue().actionable;
  const { suggestions, dismissSessions } = useSessionSuggestions(sessions);
  const [showMore, setShowMore] = useState(false);
  const [width, setWidth] = useState(() => Math.min(380, Math.max(220, Number(localStorage.getItem("deck.sidebar.width")) || 252)));
  const resizing = useRef<{ x: number; width: number }>();
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [hooks, setHooks] = useState<Record<Agent, boolean>>({ claude: true, codex: true });
  const [setup, setSetup] = useState<Agent>();
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const agent of ["claude", "codex"] as const) void window.deck.sessions.hooksInstalled(agent).then((ready) => setHooks((prev) => ({ ...prev, [agent]: ready })));
  }, []);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    window.addEventListener("mousedown", dismiss);
    return () => window.removeEventListener("mousedown", dismiss);
  }, [menu]);
  const byTerm = new Map(sessions.filter((session) => session.term_id && session.status !== "ended").reverse().map((session) => [session.term_id, session]));
  const liveAgentTabs = tabs.flatMap((tab) => {
    const session = byTerm.get(tab.termId);
    return session && !session.session_id.startsWith("pending:") ? [{ tab, session }] : [];
  });
  const openIds = new Set(tabs.map((tab) => tab.termId));
  const openSessions = new Set(tabs.map((tab) => tab.sessionId));
  const matches = (text: string, status?: string) => text.toLowerCase().includes(query.trim().toLowerCase()) && (filter === "all" || status === "needs_input" || status === "needs_review");
  const visibleTabs = tabs.filter((tab) => {
    const session = byTerm.get(tab.termId);
    return matches([tab.customTitle, tab.title, tab.cwd, tab.agent, session?.title, session?.issue_key].join(" "), session?.status);
  });
  const available = (session: AgentSession) => !openIds.has(session.term_id ?? "") && !openSessions.has(session.session_id) && !session.session_id.startsWith("pending:");
  const recent = suggestions.filter((session) => available(session) && matches(`${session.title} ${session.cwd} ${session.agent}`, session.status));
  const searching = query.trim().length > 0;
  const searchResults = searching ? sessions.filter((session) => available(session) && matches(`${session.title} ${session.cwd} ${session.agent} ${session.issue_key ?? ""}`, session.status)) : [];
  const lastSession = recent[0];
  const resume = async (session: AgentSession) => {
    setArchive(false);
    try {
      await newTab({ agent: session.agent, cwd: session.cwd, sessionId: session.session_id, issueKey: session.issue_key ?? undefined });
      onView("terminal");
    } catch (error) { setError(String(error)); }
  };
  const closeAllTabs = () => {
    dismissSessions(sessions.map((session) => session.session_id));
    tabs.forEach((tab) => closeTab(tab.termId));
    setMenu(false);
    setShowMore(false);
  };
  const launch = async (agent?: Agent) => {
    setMenu(false);
    try { await newTab({ agent }); onView("terminal"); }
    catch (error) { setError(String(error)); }
  };
  const keybinds = resolveKeybinds(settings?.keybinds);
  const defaultAgent = settings?.defaultAgent ?? "claude";
  const layers = settings?.layers ?? [];
  const activeLayer = settings?.activeLayer ?? "";
  const layerGroups = (settings?.groups ?? []).filter((group) => group.layer === activeLayer);
  const groupById = new Map(layerGroups.map((group) => [group.id, group]));
  const layerCounts = allTabs.reduce<Record<string, number>>((counts, tab) => {
    if (!layers.length) return counts;
    const id = layerOf(tab.layerId, layers);
    counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }, {});
  const waitingByLayer = allTabs.reduce<Record<string, number>>((counts, tab) => {
    const status = byTerm.get(tab.termId)?.status;
    if (!layers.length || (status !== "needs_input" && status !== "needs_review")) return counts;
    const id = layerOf(tab.layerId, layers);
    counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }, {});
  // Groups of other layers are untouched by an edit to this layer's.
  const saveGroups = (next: TabGroup[]) => void window.deck.updateSettings({
    groups: [...(settings?.groups ?? []).filter((group) => group.layer !== activeLayer), ...next],
  });
  const newGroup = (...termIds: string[]) => void createGroup(termIds);

  // Dropping a tab onto another joins that one's group, or starts a group
  // holding the pair when it has none.
  const groupWith = (dragged: string, target: TermTab) => {
    moveTab(dragged, target.termId);
    if (target.groupId) setTabGroup(dragged, target.groupId);
    else newGroup(target.termId, dragged);
  };
  // Ungrouping a group takes its subgroups with it: they exist to sit inside
  // it, so leaving them behind would orphan rows the user meant to flatten.
  const ungroup = (group: TabGroup) => {
    const gone = new Set([group.id, ...layerGroups.filter((other) => other.parent === group.id).map((other) => other.id)]);
    allTabs.filter((tab) => tab.groupId && gone.has(tab.groupId)).forEach((tab) => setTabGroup(tab.termId, null));
    saveGroups(layerGroups.filter((other) => !gone.has(other.id)));
  };
  // A one-click close has no confirm step, so it leaves an undo behind for the
  // misclick. The group or layer goes back before its tabs do: main checks a
  // new terminal's placement against the stored settings.
  const offerUndo = (name: string, held: TermTab[], restore: () => Promise<void>) => {
    clearTimeout(undoTimer.current);
    setUndo({ label: `${name} (${held.length} tab${held.length === 1 ? "" : "s"})`, restore });
    undoTimer.current = setTimeout(() => setUndo(undefined), 10000);
  };
  const closeGroup = (group: TabGroup, held: TermTab[]) => {
    held.forEach((tab) => requestCloseTab(tab.termId));
    ungroup(group);
    offerUndo(group.name, held, async () => {
      const current = await window.deck.getSettings();
      await window.deck.updateSettings({ groups: [...current.groups, group] });
      await reopenTabs(held.length);
    });
  };
  const closeLayer = (id: string) => {
    const layer = layers.find((other) => other.id === id);
    const held = allTabs.filter((tab) => layerOf(tab.layerId, layers) === id);
    held.forEach((tab) => requestCloseTab(tab.termId));
    if (!layer) return;
    offerUndo(layer.name, held, async () => {
      const current = await window.deck.getSettings();
      await window.deck.updateSettings({ layers: [...current.layers, layer], activeLayer: layer.id });
      await reopenTabs(held.length);
    });
  };
  const waitingIn = (members: TermTab[]) =>
    members.filter((tab) => ["needs_input", "needs_review"].includes(byTerm.get(tab.termId)?.status ?? "")).length;

  const pausedHere = visibleTabs.filter((tab) => tab.paused);
  const pausedAgents = pausedHere.filter((tab) => tab.agent).length;
  const pausedSummary = [
    pausedAgents > 0 ? `${pausedAgents} agent session${pausedAgents > 1 ? "s" : ""}` : "",
    pausedHere.length - pausedAgents > 0 ? `${pausedHere.length - pausedAgents} shell${pausedHere.length - pausedAgents > 1 ? "s" : ""}` : "",
  ].filter(Boolean).join(" · ");

  // Tabs render in their own order, and a group opens at its first member so a
  // tab never jumps across the sidebar just for being grouped. A subgroup (what
  // splitting a grouped tab makes) renders inside its parent, below the tabs
  // the parent holds directly.
  const rows: React.JSX.Element[] = [];
  const done = new Set<string>();
  const drawn = new Set<string>();
  const membersOf = (group: TabGroup) => visibleTabs.filter((tab) => tab.groupId === group.id);
  const childrenOf = (group: TabGroup) => layerGroups.filter((other) => other.parent === group.id);
  const row = (tab: TermTab, group?: TabGroup, indent = 0) => <SessionRow key={tab.termId} tab={tab} session={byTerm.get(tab.termId)}
    index={tabs.indexOf(tab)} indent={indent} groupColor={group?.color} onGroupWith={groupWith} onNewGroup={newGroup}
    onOpen={() => { focusTab(tab.termId); onView("terminal"); }} />;
  const groupRows = (group: TabGroup, depth: number) => {
    drawn.add(group.id);
    const members = membersOf(group);
    const children = childrenOf(group);
    // A collapsed group carries the count of everything folded under it,
    // subgroups included, so nothing disappears without a number for it.
    const held = [...members, ...children.flatMap(membersOf)];
    held.forEach((tab) => done.add(tab.termId));
    rows.push(<GroupHeader key={group.id} group={group} count={held.length} waiting={waitingIn(held)} nested={depth > 0}
      onToggle={() => saveGroups(layerGroups.map((other) => other.id === group.id ? { ...other, collapsed: !other.collapsed } : other))}
      onChange={(next) => saveGroups(layerGroups.map((other) => other.id === group.id ? next : other))}
      onDelete={() => ungroup(group)}
      onClose={() => closeGroup(group, held)}
      onDropTab={(termId) => setTabGroup(termId, group.id)} />);
    if (group.collapsed) return;
    for (const member of members) rows.push(row(member, group, depth + 1));
    for (const child of children) groupRows(child, depth + 1);
  };
  for (const tab of visibleTabs) {
    if (done.has(tab.termId)) continue;
    const group = tab.groupId ? groupById.get(tab.groupId) : undefined;
    // A subgroup is drawn as part of its parent, so the parent is what the
    // first member of either opens.
    const top = group?.parent ? groupById.get(group.parent) ?? group : group;
    if (!top) { done.add(tab.termId); rows.push(row(tab)); continue; }
    groupRows(top, 0);
  }
  // An emptied group keeps its header, so it is still a place to drop a tab.
  for (const group of layerGroups) if (!group.parent && !drawn.has(group.id)) groupRows(group, 0);

  return <aside aria-label="Sessions" style={{ width }} onWheel={onWheel} className="relative flex shrink-0 select-none flex-col border-r border-edge bg-panel font-sans">
    <div role="separator" aria-label="Resize sidebar" aria-orientation="vertical" tabIndex={0}
      onDoubleClick={() => { setWidth(252); localStorage.setItem("deck.sidebar.width", "252"); }}
      onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); setWidth((width) => Math.min(380, Math.max(220, width + (event.key === "ArrowRight" ? 10 : -10)))); } }}
      onPointerDown={(event) => { resizing.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (resizing.current) setWidth(Math.min(380, Math.max(220, resizing.current.width + event.clientX - resizing.current.x))); }}
      onPointerUp={() => { resizing.current = undefined; localStorage.setItem("deck.sidebar.width", String(width)); }}
      className="absolute -right-0.5 bottom-0 top-0 z-40 w-1 cursor-col-resize select-none hover:bg-edge3" />
    <div className="relative flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3" ref={menuRef}>
      <Icon name="search" size={12} className="text-mut" />
      <input aria-label="Search tabs" placeholder="Search tabs…" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[12px] text-soft outline-none placeholder:text-dim" />
      {settings?.experiments.sessionSweep && <button aria-label="Sweep sessions" title="Sweep: close sessions whose pull requests are merged" onClick={() => setSweepOpen(true)} className="text-mut hover:text-ink"><Icon name="broom" size={14} /></button>}
      <button aria-label="Show sessions needing attention" aria-pressed={filter === "attention"} title="Filter: needs attention" onClick={() => setFilter(filter === "all" ? "attention" : "all")} className={filter === "attention" ? "text-orange" : "text-mut hover:text-ink"}><Icon name="sliders" size={14} /></button>
      <button aria-label="New session" aria-expanded={menu} title="New session" onClick={() => setMenu(!menu)} className="text-mut hover:text-ink"><Icon name="plus" size={16} /></button>
      {menu && <div className="absolute right-2 top-9 z-50 w-48 rounded-lg border border-edge3 bg-overlay p-1 shadow-xl">
        <button aria-label="New terminal" onClick={() => void launch()} className="menu-item"><Icon name="terminal" />New terminal<span className="ml-auto text-dim">{formatChord(keybinds["tab.new"])}</span></button>
        {(["claude", "codex"] as const).map((agent) => <button key={agent} aria-label={`New ${agentLabels[agent]}`} onClick={() => void launch(agent)} className="menu-item"><Icon name="sparkle" />New {agentLabels[agent]}{agent === defaultAgent && <span className="ml-auto text-dim">{formatChord(keybinds["tab.newAgent"])}</span>}</button>)}
        <button onClick={() => { setMenu(false); newGroup(); }} className="menu-item"><Icon name="layers" />New group</button>
        <div className="my-1 border-t border-edge2" />
        <button disabled={!tabs.length} onClick={closeAllTabs} className="menu-item disabled:opacity-40"><Icon name="x" />Close all tabs</button>
        <button onClick={() => { setMenu(false); setArchive(true); }} className="menu-item"><Icon name="terminal" />Session archive</button>
        <button onClick={() => { setMenu(false); setWorktreesOpen(true); }} className="menu-item"><Icon name="layers" />Worktrees</button>
        <button onClick={() => { setMenu(false); onView("settings"); }} className="menu-item"><Icon name="cog" />Settings</button>
      </div>}
    </div>
    {layers.length > 0 && <LayerStrip layers={layers} activeLayer={activeLayer} counts={layerCounts}
      onSwitch={(id) => { void window.deck.updateSettings({ activeLayer: id }); onView("terminal"); }}
      paused={pausedByLayer}
      onDropTab={(termId, layer) => moveTabToLayer(termId, layer)}
      onChange={(next, active) => void window.deck.updateSettings({ layers: next, activeLayer: active })}
      waiting={waitingByLayer}
      onCloseLayer={closeLayer} />}
    {undo && <div className="mx-3 mt-2 flex items-center gap-2 rounded-md border border-edge2 bg-card px-2.5 py-1.5 text-[11px] text-mut">
      <span className="min-w-0 truncate">Closed {undo.label}</span>
      <button className="ml-auto shrink-0 text-accent hover:underline" onClick={() => { clearTimeout(undoTimer.current); setUndo(undefined); void undo.restore(); }}>Undo</button>
    </div>}
    <div className="min-h-0 flex-1 overflow-y-auto">
      {pausedHere.length > 0 && !searching && <section aria-label="Paused tabs" className="mx-3 mb-1 mt-3 rounded-lg border border-dashed border-edge2 bg-card/40 p-3">
        <div className="text-[11px] font-medium text-mut">{pausedHere.length} paused from last time</div>
        <div className="mt-1 text-[10px] text-dim">{pausedSummary}</div>
        <button onClick={() => void pausedHere.reduce((queue, tab) => queue.then(() => resumeTab(tab.termId)), Promise.resolve())}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-edge2 py-1.5 text-[11px] text-soft hover:border-edge3 hover:bg-card2">
          <Icon name="play" size={10} />Resume all
        </button>
      </section>}
      {rows}
      {!searching && lastSession && <section aria-label="Session suggestions" className="mx-3 my-3 rounded-lg border border-edge2 bg-card/50 p-3">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[11px] font-medium text-mut">Continue your last session</span>
          <button aria-label="Dismiss all session suggestions" title="Dismiss all suggestions" onClick={() => { dismissSessions(suggestions.filter(available).map((session) => session.session_id)); setShowMore(false); }} className="shrink-0 rounded p-0.5 text-dim hover:bg-card2 hover:text-soft"><Icon name="x" size={11} /></button>
        </div>
        <button aria-label={`Continue ${lastSession.title || agentLabels[lastSession.agent]}`} onClick={() => void resume(lastSession)} className="mt-3 flex w-full min-w-0 items-center gap-2 text-left">
          <SessionIcon agent={lastSession.agent} />
          <span className="min-w-0 flex-1"><span className="block truncate text-xs text-soft" title={lastSession.title || lastSession.cwd}>{lastSession.title || lastSession.cwd.split("/").pop()}</span><span className="mt-0.5 block truncate text-[10px] text-dim">{agentLabels[lastSession.agent]} · {Math.floor((Date.now() - lastSession.updated_at) / 60_000) < 1 ? "Just now" : `${Math.floor((Date.now() - lastSession.updated_at) / 60_000)}m ago`}</span></span>
          <span className="text-mut">↗</span>
        </button>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-dim">
          {recent.length > 1 && <button aria-expanded={showMore} onClick={() => setShowMore(!showMore)} className="hover:text-soft">{showMore ? "Show less" : `More recent (${recent.length - 1})`}</button>}
          <button onClick={() => onView("search")} className="ml-auto hover:text-soft">Search history</button>
        </div>
        {showMore && recent.slice(1).map((session) => <div key={session.session_id} className="mt-2 flex items-center gap-2 border-t border-edge pt-2">
          <button onClick={() => void resume(session)} className="min-w-0 flex-1 text-left"><span className="block truncate text-[11px] text-body" title={session.title || session.cwd}>{session.title || session.cwd.split("/").pop()}</span><span className="block truncate text-[10px] text-dim">{agentLabels[session.agent]} · {shortPath(session.cwd)}</span></button>
          <button aria-label={`Dismiss ${session.title || agentLabels[session.agent]}`} onClick={() => dismissSessions([session.session_id])} className="text-dim hover:text-soft"><Icon name="x" size={11} /></button>
        </div>)}
      </section>}
      {searchResults.length > 0 && <div className="px-4 pb-1 pt-4 text-[10px] tracking-widest text-dim">OTHER SESSIONS</div>}
      {searchResults.map((session) => <button key={session.session_id} onClick={() => void resume(session)} className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-card">
        <SessionIcon agent={session.agent} />
        <span className="min-w-0 flex-1"><span className="block truncate text-xs text-body">{session.title || session.cwd.split("/").pop()}</span><span className="block truncate text-[10px] text-dim">{agentLabels[session.agent]} · {shortPath(session.cwd)}</span></span>
      </button>)}
      {searching && !visibleTabs.length && !searchResults.length && <div className="p-4 text-xs text-dim">No matching sessions</div>}

    </div>
    {error && <div className="px-3 py-2 text-[11px] text-red">{error}</div>}
    {(["claude", "codex"] as const).filter((agent) => !hooks[agent]).map((agent) => <button key={agent} className="flex items-center gap-2 border-t border-edge px-4 py-2 text-left text-[11px] text-mut hover:text-ink" onClick={async () => {
      try { await window.deck.sessions.installHooks(agent); setHooks((prev) => ({ ...prev, [agent]: true })); setSetup(agent); }
      catch (error) { setError(String(error)); }
    }}><Icon name="link" size={11} />Enable {agentLabels[agent]} live status</button>)}
    {setup === "codex" && <div className="flex items-start gap-2 px-4 py-2 text-[11px] text-mut">In Codex, open /hooks and trust Deck’s hooks.<button title="Dismiss" onClick={() => setSetup(undefined)}><Icon name="x" size={11} /></button></div>}
    {archive && <SessionArchive sessions={sessions} onResume={(session) => void resume(session)} onClose={() => setArchive(false)} />}
    {worktreesOpen && <WorktreeSweep onClose={() => setWorktreesOpen(false)} />}
    {sweepOpen && <SessionSweep rows={liveAgentTabs} onClose={() => setSweepOpen(false)} />}
    {(settings?.customButtons ?? []).length > 0 && <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-edge px-2 py-1.5">
      {(settings?.customButtons ?? []).map((button) => <button key={button.id} aria-label={button.label} title={button.command}
        onClick={async () => { const result = await window.deck.customButton.run(button.id); if (!result.ok) setError(result.error ?? `${button.label} failed`); }}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-mut hover:bg-card hover:text-ink">
        <Icon name={iconName(button.icon)} size={12} />{button.label}
      </button>)}
    </div>}
    <div className="@container relative flex h-10 shrink-0 items-center gap-1 border-t border-edge px-2">
      {footerIndex >= 0 && <span aria-hidden className="absolute bottom-2 top-2 rounded bg-card2 transition-[left] duration-200 ease-out" style={{ width: `calc((100% - 16px - ${(footerViews.length - 1) * 4}px) / ${footerViews.length})`, left: `calc(8px + (100% - 16px + 4px) / ${footerViews.length} * ${footerIndex})` }} />}
      {footerViews.map((target) => {
        const badge = target === "agent" ? attention : target === "reviews" ? reviews : 0;
        return <button key={target} onClick={() => onView(target)} title={target} className={`relative flex h-6 min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2 text-[11px] transition-colors duration-200 ${view === target ? "text-soft" : "text-dim hover:text-body"}`}><Icon name={target === "terminal" ? "terminal" : target === "board" ? "grid" : target === "reviews" ? "check" : "sparkle"} size={12} className="shrink-0" /><span className="hidden truncate @[300px]:inline">{target}</span>{badge > 0 && <span aria-label={`${badge} ${target === "agent" ? "need attention" : "to review"}`} className="shrink-0 rounded-full bg-orange/20 px-1.5 text-[10px] text-orange">{badge}</span>}</button>;
      })}
    </div>
  </aside>;
}

/** Settings hold an icon as free text, so an unknown name draws a dot rather
 *  than crashing the sidebar. */
function iconName(name: string): IconName {
  return isIconName(name) ? name : "dot";
}
