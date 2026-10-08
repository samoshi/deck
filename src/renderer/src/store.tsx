import { sessionAgent, sessionKey, type AgentLaunch } from "../../shared/agents.js";
import type { TermMeta } from "../../main/pty.js";
import type { AgentSession } from "../../main/sessions.js";
import type { Worktree } from "../../main/worktrees.js";
import { layerColors, layerOf, type TabGroup } from "../../shared/settings.js";
import { paneReleased, paneRenamed } from "./lib/bus.js";
import { restoredTabs } from "./lib/restore.js";
import { useSettings } from "./lib/useSettings.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Terminal tabs live at app level so the sidebar, search overlay and
// terminal view all share them.

export interface TermTab extends AgentLaunch {
  termId: string;
  title: string;
  cwd?: string;
  /** A program other than the shell is running, so the tab is not at a prompt. */
  busy?: boolean;
  customTitle?: string;
  /** Color the running program set over OSC 6; agents tint per state. */
  tabColor?: string;
  /** agent session this tab was opened to resume. */
  sessionId?: string;
  /** Layer the tab sits in; unset means it predates layers and falls to the first. */
  layerId?: string;
  /** Group within that layer, when it is in one. */
  groupId?: string;
  /** A tab deck remembered from a previous run, with no terminal behind it
   *  yet. Resuming starts one in the same folder, on the same agent session. */
  paused?: boolean;
}

export interface OpenOptions extends AgentLaunch {
  cwd?: string;
  /** Group the tab opens into; the focused tab's group when left out. */
  group?: string;
  /** Layer the tab opens into; the active one when left out. */
  layer?: string;
  command?: string;
  issueKey?: string;
  /** Resume this agent session; a tab already resuming it is focused instead. */
  sessionId?: string;
}

/** A close waiting on the user's answer about the tab's worktree. */
export interface WorktreeClose {
  termId: string;
  worktree: Worktree;
}

interface TabStore {
  /** The active layer's tabs: what the sidebar lists and the number chords reach. */
  tabs: TermTab[];
  /** Every tab of the workspace, across all layers, for search and counts. */
  allTabs: TermTab[];
  activeId?: string;
  /** False until terminals surviving from before the reload are restored. */
  ready: boolean;
  newTab: (opts?: OpenOptions) => Promise<void>;
  closeTab: (termId: string, kill?: boolean) => void;
  /** Closes a tab, first asking about its worktree when it has one. */
  requestCloseTab: (termId: string) => void;
  /** Set while that question is on screen. */
  worktreeClose?: WorktreeClose;
  dismissWorktreeClose: () => void;
  /** Reopens the most recently closed tab: the same session for an agent tab, a shell in the same folder otherwise. */
  reopenTab: () => Promise<void>;
  /** Reopens the last `count` closed tabs, each back in the layer and group it
   *  was in. Whoever calls this puts that layer or group back first. */
  reopenTabs: (count: number) => Promise<void>;
  focusTab: (termId: string) => void;
  setTitle: (termId: string, title: string) => void;
  setTabColor: (termId: string, color: string | null) => void;
  renameTab: (termId: string, title: string) => void;
  /** Reorders a tab to sit where `beforeId` sits; the end of the list without one. */
  moveTab: (termId: string, beforeId?: string) => void;
  /** Hands the terminal to another workspace; it leaves this one's tabs without closing. */
  moveTabToWorkspace: (termId: string, workspace: string) => void;
  /** Moves a tab to another layer, leaving whatever group it was in. */
  moveTabToLayer: (termId: string, layer: string) => void;
  /** Puts a tab in a group, or takes it out of one with null. */
  setTabGroup: (termId: string, group: string | null) => void;
  /** Opens a group in the active layer holding the given tabs and answers with
   *  its id. `parent` nests it inside another group, which is what a split of
   *  an already grouped tab does. */
  createGroup: (termIds: string[], opts?: { parent?: string; name?: string }) => Promise<string>;
  /** Starts the terminal behind a paused tab, in its place in the list. */
  resumeTab: (termId: string) => Promise<void>;
  /** Paused tabs still waiting in a layer, by layer id. */
  pausedByLayer: Record<string, number>;
}

const Ctx = createContext<TabStore | null>(null);

export function TabProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [ready, setReady] = useState(false);
  const [worktreeClose, setWorktreeClose] = useState<WorktreeClose>();
  const settings = useSettings();

  const toTab = (meta: TermMeta): TermTab => ({
    termId: meta.id,
    title: meta.agent ?? meta.command?.split(" ")[0] ?? "shell",
    cwd: meta.cwd,
    busy: meta.busy,
    customTitle: localStorage.getItem(`deck.tab.name.${meta.id}`) ?? undefined,
    layerId: meta.layer,
    groupId: meta.group,
    agent: meta.agent ?? (/^codex(?:\s|$)/.test(meta.command ?? "") ? "codex" : /^claude(?:\s|$)/.test(meta.command ?? "") ? "claude" : undefined),
    sessionId: meta.sessionId ?? (meta.command?.startsWith("codex resume ") ? sessionKey("codex", /codex resume ['"]?([^\s'"]+)/.exec(meta.command)?.[1] ?? "") : undefined) ?? /--resume ['"]?([^\s'"]+)/.exec(meta.command ?? "")?.[1],
  });

  // The agent running in a tab is only known through its hooks, so a tab
  // carries the session live in its terminal; that is what a reopen resumes.
  const withSession = (tab: TermTab, sessions: AgentSession[]): TermTab => {
    const session = sessions.find((session) => session.term_id === tab.termId && session.status !== "ended" && !session.session_id.startsWith("pending:"));
    return session ? { ...tab, sessionId: session.session_id, agent: session.agent, cwd: tab.cwd || session.cwd } : tab;
  };

  // Callbacks read the live tab list, and a session being resumed is held
  // here until its tab exists so a double click can't open it twice.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeCwd = useRef<string>();
  activeCwd.current = settings?.newTerminalCwd.tab === "current" ? tabs.find((tab) => tab.termId === activeId)?.cwd : undefined;
  // A tab opened while a grouped tab is in focus joins that group, so a group
  // is somewhere you work rather than something you refill by hand.
  const activeGroup = useRef<string>();
  activeGroup.current = tabs.find((tab) => tab.termId === activeId)?.groupId;
  const resuming = useRef(new Set<string>());
  const closed = useRef<TermTab[]>([]);

  // Terminals live in the pty host, so a reload (or a restarted main
  // process) finds the previous tabs still running. The list is re-read when
  // the window settings or the workspace change, since they decide which
  // tabs this window sees.
  const windowMode = settings?.windowMode;
  const workspace = settings?.activeWorkspace;
  useEffect(() => {
    void Promise.all([window.deck.term.list(), window.deck.sessions.list(), window.deck.term.remembered()]).then(([terms, sessions, remembered]) => {
      const order: string[] = JSON.parse(localStorage.getItem("deck.tab.order") ?? "[]");
      const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
      const live = [...terms].sort((a, b) => rank(a.id) - rank(b.id)).map((meta) => withSession(toTab(meta), sessions));
      setTabs(restoredTabs(live, remembered));
      setActiveId((active) => terms.some((term) => term.id === active) ? active : live.at(-1)?.termId);
      setReady(true);
    });
  }, [windowMode, workspace]);

  // What each terminal's agent called its session, so a tab paused tomorrow
  // still reads as the work it was rather than as "claude".
  const sessionTitles = useRef(new Map<string, string>());
  const noteTitles = (sessions: AgentSession[]): void => {
    for (const session of sessions) if (session.term_id && session.title) sessionTitles.current.set(session.term_id, session.title);
  };
  useEffect(() => { void window.deck.sessions.list().then(noteTitles); }, []);

  useEffect(() => window.deck.sessions.onChanged((sessions) => {
    noteTitles(sessions);
    setTabs((tabs) => tabs.map((tab) => withSession(tab, sessions)));
  }), []);

  const newTab = useCallback(async (opts: OpenOptions = {}) => {
    const agent = opts.agent ?? (opts.sessionId ? sessionAgent(opts.sessionId) : undefined);
    const sessionId = opts.sessionId ? sessionKey(agent!, opts.sessionId) : undefined;
    // Work for an issue belongs in its repo or the default folder, never in
    // whatever folder the active terminal happens to be in.
    const cwd = opts.cwd ?? (opts.issueKey ? undefined : activeCwd.current);
    const create = { ...opts, cwd, agent, sessionId, group: opts.group ?? activeGroup.current };
    if (sessionId && resuming.current.has(sessionId)) return;
    if (sessionId) resuming.current.add(sessionId);
    try {
      if (sessionId) {
        const sessions = await window.deck.sessions.list();
        const session = sessions.find((session) => session.session_id === sessionId);
        const open = tabsRef.current.find((tab) => tab.sessionId === sessionId);
        if (open && session?.status !== "ended") { setActiveId(open.termId); return; }
        const live = session?.status !== "ended" && tabsRef.current.find((tab) => tab.termId === session?.term_id);
        if (live) { setActiveId(live.termId); return; }
      }
      const meta = await window.deck.term.create(create);
      setTabs((tabs) => tabs.some((tab) => tab.termId === meta.id) ? tabs : [...tabs, toTab(meta)]);
      setActiveId(meta.id);
    } finally {
      if (sessionId) resuming.current.delete(sessionId);
    }
  }, []);

  useEffect(() => window.deck.term.onCreated((meta) => {
    setTabs((tabs) => tabs.some((tab) => tab.termId === meta.id) ? tabs : [...tabs, toTab(meta)]);
  }), []);

  // Starts the terminal a paused tab stands for, in its own place in the list.
  // The created event may land first, so the real tab is deduped either way.
  const resumeTab = useCallback(async (termId: string) => {
    const tab = tabsRef.current.find((tab) => tab.termId === termId);
    if (!tab?.paused || resuming.current.has(termId)) return;
    resuming.current.add(termId);
    try {
      const meta = await window.deck.term.create({ cwd: tab.cwd, agent: tab.agent, sessionId: tab.sessionId, layer: tab.layerId, group: tab.groupId });
      if (tab.customTitle) localStorage.setItem(`deck.tab.name.${meta.id}`, tab.customTitle);
      // The pane layout is keyed by terminal id and kept by the terminal view,
      // so it is told about the swap before the tab list changes under it.
      paneRenamed(termId, meta.id);
      setTabs((tabs) => {
        const real = toTab(meta);
        return tabs.filter((other) => other.termId !== meta.id).map((other) => other.termId === termId ? real : other);
      });
      setActiveId(meta.id);
    } finally {
      resuming.current.delete(termId);
    }
  }, []);

  const closeTab = useCallback((termId: string, kill = true) => {
    // A paused tab has no terminal to kill and nothing to reopen.
    if (tabsRef.current.find((tab) => tab.termId === termId)?.paused) {
      setTabs((tabs) => tabs.filter((tab) => tab.termId !== termId));
      return;
    }
    if (kill) window.deck.term.kill(termId);
    // A killed terminal also reports its exit, so the same tab may arrive here twice.
    const tab = tabsRef.current.find((tab) => tab.termId === termId);
    if (tab && closed.current.at(-1)?.termId !== termId) closed.current = [...closed.current.slice(-9), tab];
    localStorage.removeItem(`deck.tab.name.${termId}`);
    setTabs((tabs) => {
      const i = tabs.findIndex((t) => t.termId === termId);
      const next = tabs.filter((t) => t.termId !== termId);
      setActiveId((active) =>
        active === termId ? next[Math.min(i, next.length - 1)]?.termId : active,
      );
      return next;
    });
  }, []);

  // Only a tab sitting in a linked worktree raises the question, so an ordinary
  // tab still closes on the first click.
  const requestCloseTab = useCallback((termId: string) => {
    const tab = tabsRef.current.find((tab) => tab.termId === termId);
    if (!tab?.cwd || tab.paused) { closeTab(termId); return; }
    void window.deck.worktrees.at(tab.cwd).then((worktree) => {
      if (!worktree) { closeTab(termId); return; }
      setWorktreeClose({ termId, worktree });
    }, () => closeTab(termId));
  }, [closeTab]);

  const dismissWorktreeClose = useCallback(() => setWorktreeClose(undefined), []);

  const reopenTab = useCallback(async () => {
    const tab = closed.current.pop();
    if (tab) await newTab({ agent: tab.agent, cwd: tab.cwd, sessionId: tab.sessionId });
  }, [newTab]);

  // Undoing a group or layer close, which closed several tabs at once. Main
  // checks a new terminal's placement against the stored settings, so the
  // caller restores the group or layer before these go back into it.
  const reopenTabs = useCallback(async (count: number) => {
    const batch = closed.current.slice(-count);
    closed.current = closed.current.slice(0, Math.max(0, closed.current.length - count));
    for (const tab of batch) {
      await newTab({ agent: tab.agent, cwd: tab.cwd, sessionId: tab.sessionId, layer: tab.layerId, group: tab.groupId });
    }
  }, [newTab]);

  const setTitle = useCallback((termId: string, title: string) => {
    setTabs((tabs) => tabs.map((t) => (t.termId === termId ? { ...t, title } : t)));
  }, []);

  const setTabColor = useCallback((termId: string, color: string | null) => {
    setTabs((tabs) => tabs.map((tab) => tab.termId === termId ? { ...tab, tabColor: color ?? undefined } : tab));
  }, []);

  const renameTab = useCallback((termId: string, title: string) => {
    localStorage.setItem(`deck.tab.name.${termId}`, title.trim());
    setTabs((tabs) => tabs.map((tab) => tab.termId === termId ? { ...tab, customTitle: title.trim() || undefined } : tab));
  }, []);

  // The sidebar only ever shows one layer, so a drop names the tab to land in
  // front of rather than a position in the full list.
  const moveTab = useCallback((termId: string, beforeId?: string) => {
    setTabs((tabs) => {
      const tab = tabs.find((t) => t.termId === termId);
      if (!tab) return tabs;
      const next = tabs.filter((t) => t !== tab);
      const at = beforeId ? next.findIndex((t) => t.termId === beforeId) : -1;
      next.splice(at < 0 ? next.length : at, 0, tab);
      localStorage.setItem("deck.tab.order", JSON.stringify(next.map((t) => t.termId)));
      return next;
    });
  }, []);

  const moveTabToLayer = useCallback((termId: string, layer: string) => {
    window.deck.term.place(termId, { layer, group: null });
    paneReleased(termId);
    setTabs((tabs) => tabs.map((tab) => tab.termId === termId ? { ...tab, layerId: layer, groupId: undefined } : tab));
  }, []);

  const setTabGroup = useCallback((termId: string, group: string | null) => {
    window.deck.term.place(termId, { group });
    setTabs((tabs) => tabs.map((tab) => tab.termId === termId ? { ...tab, groupId: group ?? undefined } : tab));
  }, []);

  // Main checks a new terminal's group against the stored settings, so the
  // group has to be written before anything can be opened into it.
  const groups = settings?.groups;
  const activeLayerId = settings?.activeLayer;
  const createGroup = useCallback(async (termIds: string[], opts: { parent?: string; name?: string } = {}) => {
    const siblings = (groups ?? []).filter((group) => group.layer === activeLayerId);
    const group: TabGroup = {
      id: `group-${Date.now().toString(36)}`,
      layer: activeLayerId ?? "",
      parent: opts.parent,
      name: opts.name?.trim() || `Group ${siblings.length + 1}`,
      color: layerColors[siblings.length % layerColors.length],
    };
    await window.deck.updateSettings({ groups: [...(groups ?? []), group] });
    for (const termId of termIds) setTabGroup(termId, group.id);
    return group.id;
  }, [groups, activeLayerId, setTabGroup]);

  const moveTabToWorkspace = useCallback((termId: string, workspace: string) => {
    window.deck.term.moveToWorkspace(termId, workspace);
    setTabs((tabs) => {
      const i = tabs.findIndex((t) => t.termId === termId);
      const next = tabs.filter((t) => t.termId !== termId);
      setActiveId((active) => (active === termId ? next[Math.min(i, next.length - 1)]?.termId : active));
      return next;
    });
  }, []);

  useEffect(() => window.deck.term.onCwd((termId, cwd) => {
    setTabs((tabs) => tabs.map((tab) => tab.termId === termId ? { ...tab, cwd } : tab));
  }), []);

  // Tells main which directory the active tab is in, for the "current
  // project" sharing mode.
  const activeCwdNow = tabs.find((tab) => tab.termId === activeId)?.cwd;
  useEffect(() => { void window.deck.sharing.setCurrentProject(activeCwdNow); }, [activeCwdNow]);

  useEffect(() => window.deck.term.onBusy((termId, busy) => {
    setTabs((tabs) => tabs.map((tab) => tab.termId === termId ? { ...tab, busy } : tab));
  }), []);

  useEffect(() => window.deck.term.onExit((id) => closeTab(id, false)), [closeTab]);

  // Only the active layer's tabs are on screen. The rest keep running and keep
  // their place in the list; they are simply not what this layer is about.
  const layers = settings?.layers;
  const activeLayer = settings?.activeLayer;
  const layerTabs = useMemo(
    () => layers?.length ? tabs.filter((tab) => layerOf(tab.layerId, layers) === activeLayer) : tabs,
    [tabs, layers, activeLayer],
  );

  // Focusing a tab that lives in another layer switches to it, so resuming a
  // session or opening an issue's terminal never lands on a blank screen; a
  // paused tab starts its terminal rather than showing an empty pane.
  const focusTab = useCallback((termId: string) => {
    const tab = tabsRef.current.find((tab) => tab.termId === termId);
    const layer = layers?.length ? layerOf(tab?.layerId, layers) : undefined;
    if (layer && layer !== activeLayer) void window.deck.updateSettings({ activeLayer: layer });
    if (tab?.paused) { void resumeTab(termId); return; }
    setActiveId(termId);
  }, [layers, activeLayer, resumeTab]);

  // A layer switch leaves the active tab behind; the layer's own last running
  // tab takes over, and a layer of paused tabs shows none until one is resumed.
  useEffect(() => {
    const running = layerTabs.filter((tab) => !tab.paused);
    setActiveId((active) => running.some((tab) => tab.termId === active) ? active : running.at(-1)?.termId);
  }, [layerTabs]);

  // What deck brings back next time. Written on every change so a crash loses
  // nothing, and skipped entirely when the user asked deck to forget.
  const restoreTabs = settings?.restoreTabs;
  useEffect(() => {
    if (!ready || !restoreTabs || restoreTabs === "off" || !layers?.length) return;
    window.deck.term.remember(tabs.map((tab) => ({
      id: tab.termId,
      layer: layerOf(tab.layerId, layers),
      group: tab.groupId,
      cwd: tab.cwd,
      agent: tab.agent,
      sessionId: tab.sessionId,
      title: tab.customTitle || sessionTitles.current.get(tab.termId) || tab.title,
      customTitle: tab.customTitle,
    })));
  }, [tabs, ready, restoreTabs, layers]);

  // On the first load after a quit, the tabs deck is set to bring back running
  // start themselves; the rest wait paused until the user unpauses them.
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current || !restoreTabs || !layers?.length) return;
    started.current = true;
    if (restoreTabs === "off" || restoreTabs === "paused") return;
    const wanted = tabsRef.current.filter((tab) => tab.paused
      && (restoreTabs === "all" || layerOf(tab.layerId, layers) === activeLayer));
    void wanted.reduce((queue, tab) => queue.then(() => resumeTab(tab.termId)), Promise.resolve());
  }, [ready, restoreTabs, layers, activeLayer, resumeTab]);

  const pausedByLayer = useMemo(() => tabs.reduce<Record<string, number>>((counts, tab) => {
    if (!tab.paused || !layers?.length) return counts;
    const id = layerOf(tab.layerId, layers);
    counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }, {}), [tabs, layers]);

  const store = useMemo<TabStore>(
    () => ({ tabs: layerTabs, allTabs: tabs, activeId, ready, newTab, closeTab, requestCloseTab, worktreeClose, dismissWorktreeClose, reopenTab, reopenTabs, focusTab, setTitle, setTabColor, renameTab, moveTab, moveTabToWorkspace, moveTabToLayer, setTabGroup, createGroup, resumeTab, pausedByLayer }),
    [layerTabs, tabs, activeId, ready, newTab, closeTab, requestCloseTab, worktreeClose, dismissWorktreeClose, reopenTab, reopenTabs, focusTab, setTitle, setTabColor, renameTab, moveTab, moveTabToWorkspace, moveTabToLayer, setTabGroup, createGroup, resumeTab, pausedByLayer],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useTabs(): TabStore {
  const store = useContext(Ctx);
  if (!store) throw new Error("useTabs outside TabProvider");
  return store;
}
