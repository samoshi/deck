import { useDisplayMode } from "../chrome/DisplayMode.js";
import { useEffect, useRef, useState } from "react";
import { agentLabels, type Agent } from "../../../shared/agents.js";
import { onAdoptPane, onOpenTerminalTab, onPaneReleased, onPaneRenamed } from "../lib/bus.js";
import { useTips } from "../tips/TipsProvider.js";
import { useAgentSessions } from "../lib/useSessions.js";
import { shortPath, useGitSummary } from "../lib/useGitSummary.js";
import { useSettings } from "../lib/useSettings.js";
import { formatChord, matchKeybind, resolveKeybinds } from "../../../shared/keybinds.js";
import { useTabs, type TermTab } from "../store.js";
import { splitPlacement } from "../../../shared/settings.js";
import { Icon } from "../board/icons.js";
import { ChangesPanel } from "./ChangesPanel.js";
import { TerminalPane } from "./TerminalPane.js";
import { FileExplorer } from "./FileExplorer.js";
import { onTerminalAction, terminalAction } from "./actions.js";
import { arrangePane, paneIds, paneInDirection, paneRects, paneDividers, releasePane, renamePane, resizePane, splitFor, splitPane, syncLayouts, zoomPane, type PaneDirection, type PaneLayout, type PaneDivider } from "./layout.js";

const splitButtons = [
  { towards: "up", icon: "splitUp", label: "Split up" },
  { towards: "down", icon: "splitDown", label: "Split down" },
  { towards: "left", icon: "splitLeft", label: "Split left" },
  { towards: "right", icon: "splitRight", label: "Split right" },
] as const;

/** Where layouts lived when they were the renderer's own, one list shared by
 *  every window and workspace. Read once, then dropped. */
const LEGACY_LAYOUTS = "deck.pane-layouts";

const json = (layouts: PaneLayout[]): string => JSON.stringify(layouts);

export function TerminalView({ visible }: { visible: boolean }) {
  const { mode } = useDisplayMode();
  const { tabs, allTabs, activeId, ready, newTab, setTitle, setTabColor, focusTab, requestCloseTab, createGroup, setTabGroup, resumeTab } = useTabs();
  const sessions = useAgentSessions();
  const [panel, setPanel] = useState<"changes" | "files">();
  const [filesVisited, setFilesVisited] = useState(false);
  const [layouts, setLayouts] = useState<PaneLayout[]>([]);
  /** What main last agreed the layouts were. Local edits move away from it
   *  until the write lands, and only a layout still sitting on it may be
   *  replaced by what settings bring back. */
  const synced = useRef(json([]));
  const migrated = useRef(false);
  const [composer, setComposer] = useState(false);
  /** The pane a dragged tab would land beside, and on which side. */
  const [dropHint, setDropHint] = useState<{ target: string; towards: PaneDirection }>();
  /** The ratios to put back when the zoom is released; set means zoomed. */
  const [unzoomed, setUnzoomed] = useState<PaneLayout>();
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");
  const splitting = useRef(false);
  const paneArea = useRef<HTMLDivElement>(null);
  const dragging = useRef<PaneDivider>();
  const activeTab = tabs.find((tab) => tab.termId === activeId);
  const session = sessions.find((session) => session.term_id === activeId && session.status !== "ended");
  const cwd = session?.cwd || activeTab?.cwd;
  const git = useGitSummary(cwd);
  const settings = useSettings();
  const workspace = settings?.activeWorkspace;
  const { report } = useTips();
  const keybinds = resolveKeybinds(settings?.keybinds);
  const defaultAgent = settings?.defaultAgent ?? "claude";
  const needsReview = session?.status === "needs_review";
  const activeTitle = activeTab?.customTitle || session?.title || activeTab?.agent || activeTab?.title || "Terminal";
  const currentLayout = layouts.find((layout) => paneIds(layout).includes(activeId ?? ""));
  const dividers = currentLayout && mode === "normal" ? paneDividers(currentLayout) : [];
  const rects = currentLayout && mode === "normal" ? paneRects(currentLayout) : activeId ? [{ termId: activeId, left: 0, top: 0, width: 100, height: 100 }] : [];
  useEffect(() => onOpenTerminalTab((options) => void newTab(options)), [newTab]);
  useEffect(() => { if (ready && tabs.length === 0) void newTab(); }, [ready]);
  // Settings hold the layouts of the workspace on screen, so this both reads
  // the workspace being switched to and follows a split made in another window.
  // An edit of our own that has not been written yet outranks both: settings
  // change for unrelated reasons mid-split, and that must not undo the split.
  useEffect(() => {
    const stored = settings?.paneLayouts;
    if (!stored) return;
    const local = json(layouts);
    if (local === json(stored)) { synced.current = local; return; }
    if (local !== synced.current) return;
    synced.current = json(stored);
    setLayouts(stored);
  }, [settings?.paneLayouts, layouts]);
  useEffect(() => {
    if (!ready || !settings) return;
    setLayouts((layouts) => syncLayouts(layouts, allTabs.map((tab) => tab.termId)));
  }, [allTabs.map((tab) => tab.termId).join(","), ready, workspace]);
  // Resuming a paused tab swaps in a new terminal, so its pane follows the new
  // id instead of being pruned away with the old one.
  useEffect(() => onPaneRenamed(({ from, to }) => setLayouts((layouts) => layouts.map((layout) => renamePane(layout, from, to)))), []);
  // A tab sent to another layer leaves its split behind rather than holding an
  // empty slot in it; the layouts of layers off screen are no longer pruned.
  useEffect(() => onPaneReleased((termId) => setLayouts((layouts) => releasePane(layouts, termId))), []);
  // Debounced because dragging a divider rewrites the tree on every pointer
  // move, and every write here crosses to main and reaches the database.
  useEffect(() => {
    if (!ready || !settings) return;
    const local = json(layouts);
    if (local === json(settings.paneLayouts)) return;
    const timer = setTimeout(() => {
      synced.current = local;
      void window.deck.updateSettings({ paneLayouts: layouts });
    }, 150);
    return () => clearTimeout(timer);
  }, [layouts, ready, settings]);
  useEffect(() => {
    if (!ready || !settings || migrated.current) return;
    migrated.current = true;
    const stored = localStorage.getItem(LEGACY_LAYOUTS);
    if (!stored) return;
    localStorage.removeItem(LEGACY_LAYOUTS);
    try {
      const legacy: PaneLayout[] = JSON.parse(stored);
      if (legacy.length && !settings.paneLayouts.length) setLayouts(legacy);
    } catch { /* an unreadable list is no worse than the empty one it falls back to */ }
  }, [ready, settings]);
  useEffect(() => { if (panel === "files") setFilesVisited(true); }, [panel]);
  useEffect(() => { if (needsReview) setPanel("changes"); }, [needsReview, activeId]);
  // A split's second terminal is a tab of its own, so the pair is grouped: the
  // sidebar shows them side by side under a header rather than hiding one
  // inside the other's row.
  const splitGroup = async (tab: TermTab, name: string): Promise<string | undefined> => {
    const placement = splitPlacement(settings?.groups.find((group) => group.id === tab.groupId));
    return "join" in placement ? placement.join : createGroup([tab.termId], { parent: placement.parent, name });
  };
  const split = async (towards: PaneDirection, agent?: Agent) => {
    if (!activeId || splitting.current) return;
    splitting.current = true;
    const { direction, before } = splitFor[towards];
    setUnzoomed(undefined);
    try {
      const group = activeTab ? await splitGroup(activeTab, activeTitle) : undefined;
      const meta = await window.deck.term.create({ cwd: settings?.newTerminalCwd.split === "default" ? undefined : cwd, agent, group });
      setLayouts((layouts) => {
        const withoutNew = layouts.filter((layout) => !("termId" in layout && layout.termId === meta.id));
        const found = withoutNew.some((layout) => paneIds(layout).includes(activeId));
        return found ? withoutNew.map((layout) => splitPane(layout, activeId, meta.id, direction, before))
          : [...withoutNew, splitPane({ termId: activeId }, activeId, meta.id, direction, before)];
      });
      focusTab(meta.id);
    } catch (error) { setError(String(error)); }
    finally { splitting.current = false; }
  };
  // Arranging two terminals that already exist, rather than opening a third:
  // the tab leaves whatever layout it was in and lands beside the target.
  const adopt = async (termId: string, target: string, towards: PaneDirection) => {
    const targetTab = tabs.find((tab) => tab.termId === target);
    const moving = tabs.find((tab) => tab.termId === termId);
    if (termId === target || !targetTab || !moving || splitting.current) return;
    splitting.current = true;
    const { direction, before } = splitFor[towards];
    setUnzoomed(undefined);
    try {
      const group = await splitGroup(targetTab, targetTab.customTitle || targetTab.title);
      if (group) setTabGroup(termId, group);
      setLayouts((layouts) => arrangePane(layouts, termId, target, direction, before));
      // A paused tab waits in its new pane instead: resuming here would start
      // its terminal from the group it is being moved out of.
      if (!moving.paused) focusTab(termId);
    } catch (error) { setError(String(error)); }
    finally { splitting.current = false; }
  };
  // Which pane a drag is over and which of its edges is nearest; percentages,
  // to match the rects the layout works in.
  const dropAt = (event: React.DragEvent): { target: string; towards: PaneDirection } | undefined => {
    const area = paneArea.current?.getBoundingClientRect();
    if (!area) return undefined;
    const x = (event.clientX - area.left) / area.width * 100;
    const y = (event.clientY - area.top) / area.height * 100;
    const rect = rects.find((rect) => x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height);
    if (!rect) return undefined;
    const edges = [
      ["left", (x - rect.left) / rect.width],
      ["right", (rect.left + rect.width - x) / rect.width],
      ["up", (y - rect.top) / rect.height],
      ["down", (rect.top + rect.height - y) / rect.height],
    ] as const;
    return { target: rect.termId, towards: [...edges].sort((a, b) => a[1] - b[1])[0][0] };
  };
  const focusPane = (towards: PaneDirection) => {
    const next = currentLayout && activeId && paneInDirection(currentLayout, activeId, towards);
    if (next) focusTab(next);
  };
  // A zoom is a layout, not a mode: it rewrites the ratios and keeps the
  // pre-zoom ones so the same key puts the split back where it was.
  const toggleZoom = () => {
    if (!activeId || !currentLayout) return;
    setUnzoomed(unzoomed ? undefined : currentLayout);
    setLayouts((layouts) => layouts.map((layout) => paneIds(layout).includes(activeId) ? unzoomed ?? zoomPane(layout, activeId) : layout));
  };
  useEffect(() => onAdoptPane(({ termId, towards }) => { if (activeId) void adopt(termId, activeId, towards); }), [activeId, tabs, settings]);
  useEffect(() => onTerminalAction((action) => {
    if (action === "changes") setPanel((panel) => panel === "changes" ? undefined : "changes");
    if (action === "files") setPanel((panel) => panel === "files" ? undefined : "files");
    if (action === "composer") setComposer((open) => !open);
    if (action.startsWith("split-")) void split(action.slice("split-".length) as PaneDirection);
    if (action === "pane-zoom") toggleZoom();
  }), [activeId, cwd, settings, unzoomed, currentLayout]);
  // Summoning the window back restores keyboard focus to the active terminal.
  useEffect(() => {
    if (!visible) return;
    const onFocus = () => terminalAction("focus");
    window.addEventListener("focus", onFocus);
    const offFocused = window.deck.window.onFocused(onFocus);
    return () => { window.removeEventListener("focus", onFocus); offFocused(); };
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      const command = matchKeybind(keybinds, event);
      if (command?.startsWith("split.")) { event.preventDefault(); void split(command.slice("split.".length) as PaneDirection); }
      if (command?.startsWith("splitAgent.")) { event.preventDefault(); void split(command.slice("splitAgent.".length) as PaneDirection, defaultAgent); }
      if (command === "pane.zoom") { event.preventDefault(); toggleZoom(); }
      else if (command?.startsWith("pane.")) { event.preventDefault(); focusPane(command.slice("pane.".length) as PaneDirection); }
      if (command === "changes" || command === "find" || command === "composer") { event.preventDefault(); terminalAction(command); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, activeId, cwd, settings, unzoomed, currentLayout]);
  const resize = (divider: PaneDivider, ratio: number) => setLayouts((layouts) => layouts.map((layout) => paneIds(layout).includes(activeId ?? "") ? resizePane(layout, divider.path, ratio) : layout));
  const hintRect = dropHint && rects.find((rect) => rect.termId === dropHint.target);
  const submit = () => {
    if (!activeId || !command.trim()) return;
    window.deck.term.input(activeId, `\x1b[200~${command}\x1b[201~`);
    setTimeout(() => window.deck.term.input(activeId, "\r"), 200);
    setCommand("");
  };
  return <div className={`relative min-h-0 flex-1 ${visible ? "flex" : "hidden"}`}>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="workbench-chrome flex h-16 shrink-0 items-center gap-4 border-b border-edge px-4 font-sans">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-mut"><span className="truncate">{shortPath(cwd)}</span>{git && <><Icon name="branch" size={11} /><span>{git.branch}</span><span className="text-dim">· {git.changedFiles} changed</span></>}</div>
          <div className="mt-1 truncate text-[13px] font-semibold text-soft">{activeTitle}</div>
        </div>
        <div className="flex items-center gap-1">
          {splitButtons.map(({ towards, icon, label }) => <button key={towards} title={`${label} (${formatChord(keybinds[`split.${towards}`])})`} aria-label={label} onClick={() => { report({ action: "split-button" }); void split(towards); }} className="toolbar-button"><Icon name={icon} size={15} /></button>)}
          <button title={`Zoom the focused pane (${formatChord(keybinds["pane.zoom"])})`} aria-label="Zoom pane" aria-pressed={Boolean(unzoomed)} disabled={rects.length < 2} onClick={toggleZoom} className="toolbar-button disabled:opacity-30"><Icon name="maximize" size={15} /></button>
          <button title="Find in terminal (⌘F)" aria-label="Find in terminal" onClick={() => terminalAction("find")} className="toolbar-button"><Icon name="search" size={15} /></button>
          <button title="Export terminal output" aria-label="Export terminal output" onClick={() => terminalAction("export")} className="toolbar-button"><Icon name="download" size={15} /></button>
        </div>
      </div>
      {error && <div className="px-4 py-2 text-xs text-red">{error}<button className="ml-2" onClick={() => setError("")}>×</button></div>}
      <div ref={paneArea} className="relative min-h-0 flex-1"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("text/deck-tab")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropHint(dropAt(event));
        }}
        onDragLeave={(event) => { if (!paneArea.current?.contains(event.relatedTarget as Node | null)) setDropHint(undefined); }}
        onDrop={(event) => {
          const termId = event.dataTransfer.getData("text/deck-tab");
          if (!termId) return;
          event.preventDefault();
          const at = dropAt(event);
          setDropHint(undefined);
          if (at) void adopt(termId, at.target, at.towards);
        }}>
        {tabs.map((tab) => {
          const rect = rects.find((rect) => rect.termId === tab.termId);
          const shown = visible && Boolean(rect);
          return <div key={tab.termId} className={`absolute overflow-hidden ${rects.length > 1 ? `border ${tab.termId === activeId ? "border-edge3" : "terminal-pane-inactive border-edge"}` : ""}`}
            style={rect ? { left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%`, display: shown ? "flex" : "none", flexDirection: "column" } : { display: "none" }}
            onMouseDown={() => { if (activeId !== tab.termId) focusTab(tab.termId); }}>
            {rects.length > 1 && <div className="flex h-6 shrink-0 items-center gap-2 bg-panel px-3 font-sans text-[10px] text-mut"><Icon name="terminal" size={10} /><span className="truncate">{tab.customTitle || tab.title}</span><button className="ml-auto" title="Close pane" onClick={() => requestCloseTab(tab.termId)}><Icon name="x" size={10} /></button></div>}
            <div className="min-h-0 flex-1">{tab.paused
              ? <button onClick={() => void resumeTab(tab.termId)} className="flex h-full w-full flex-col items-center justify-center gap-2 font-sans text-[11px] text-dim hover:text-soft"><Icon name="play" size={14} />Resume {tab.customTitle || tab.title}</button>
              : <TerminalPane termId={tab.termId} cwd={tab.cwd} busy={tab.busy} active={shown} focused={shown && tab.termId === activeId} onTitle={(title) => setTitle(tab.termId, title)} onTabColor={(color) => setTabColor(tab.termId, color)} onCommand={(command) => report({ command })} onFileDrop={() => focusTab(tab.termId)} />}</div>
          </div>;
        })}
        {dividers.map((divider) => <div key={divider.path.join("/") || "root"} role="separator" tabIndex={0} aria-label="Resize terminal panes" aria-orientation={divider.direction === "row" ? "vertical" : "horizontal"} aria-valuenow={Math.round(divider.ratio * 100)}
          onDoubleClick={() => resize(divider, 0.5)}
          onKeyDown={(event) => { if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) { event.preventDefault(); resize(divider, divider.ratio + (["ArrowRight", "ArrowDown"].includes(event.key) ? 0.05 : -0.05)); } }}
          onPointerDown={(event) => { dragging.current = divider; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={(event) => {
            const moving = dragging.current;
            const area = paneArea.current?.getBoundingClientRect();
            if (!moving || !area) return;
            const position = moving.direction === "row" ? (event.clientX - area.left) / area.width * 100 : (event.clientY - area.top) / area.height * 100;
            const start = moving.direction === "row" ? moving.area.left : moving.area.top;
            const size = moving.direction === "row" ? moving.area.width : moving.area.height;
            resize(moving, (position - start) / size);
          }}
          onPointerUp={() => { dragging.current = undefined; }}
          style={divider.direction === "row" ? { left: `calc(${divider.area.left + divider.area.width * divider.ratio}% - 3px)`, top: `${divider.area.top}%`, width: 6, height: `${divider.area.height}%`, cursor: "col-resize" } : { top: `calc(${divider.area.top + divider.area.height * divider.ratio}% - 3px)`, left: `${divider.area.left}%`, height: 6, width: `${divider.area.width}%`, cursor: "row-resize" }}
          className="absolute z-10 select-none outline-none hover:bg-edge3 focus-visible:bg-accent" />)}
        {dropHint && hintRect && <div aria-hidden className="pointer-events-none absolute z-20 rounded border-2 border-accent/70 bg-accent/10"
          style={{
            left: `${hintRect.left + (dropHint.towards === "right" ? hintRect.width / 2 : 0)}%`,
            top: `${hintRect.top + (dropHint.towards === "down" ? hintRect.height / 2 : 0)}%`,
            width: `${dropHint.towards === "left" || dropHint.towards === "right" ? hintRect.width / 2 : hintRect.width}%`,
            height: `${dropHint.towards === "up" || dropHint.towards === "down" ? hintRect.height / 2 : hintRect.height}%`,
          }} />}
        {!tabs.length && <div className="flex h-full items-center justify-center font-sans text-xs text-dim">{formatChord(keybinds["tab.new"])} to open a terminal</div>}
      </div>
      {composer && <div className="workbench-chrome mx-4 mb-3 rounded-lg border border-edge3 bg-card px-3 py-2">
        <textarea aria-label="Command editor" autoFocus rows={3} value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && event.metaKey) { event.preventDefault(); submit(); } }} placeholder="Write a command or paste a multiline prompt…" className="w-full resize-y bg-transparent font-mono text-xs leading-5 text-soft outline-none placeholder:text-dim" />
        <div className="flex items-center gap-2 font-sans text-[10px] text-dim"><span>Send to active terminal</span><button className="ml-auto text-mut" onClick={() => setComposer(false)}>Close</button><button disabled={!command.trim()} onClick={submit} className="rounded border border-edge3 px-2 py-1 text-soft disabled:opacity-30">Send ⌘↵</button></div>
      </div>}
      <footer className="workbench-chrome flex h-10 shrink-0 items-center gap-2 border-t border-edge px-4 font-sans text-[11px] text-mut">
        <button title={`New terminal (${formatChord(keybinds["tab.new"])})`} onClick={() => { report({ action: "new-tab-button" }); void newTab(); }} className="toolbar-button"><Icon name="plus" size={13} /></button>
        <button title={`New ${agentLabels[defaultAgent]} tab (${formatChord(keybinds["tab.newAgent"])})`} onClick={() => void newTab({ agent: defaultAgent })} className="toolbar-button"><Icon name="sparkle" size={13} /></button>
        {git && <button onClick={() => terminalAction("changes")} className="flex items-center gap-1.5 rounded border border-edge2 px-2 py-0.5"><Icon name="file" size={11} /><span>{git.changedFiles}</span><span className="text-green">+{git.added}</span><span className="text-red">−{git.removed}</span></button>}
        <button onClick={() => terminalAction("files")} className={`flex items-center gap-1.5 rounded px-2 py-1 ${panel === "files" ? "bg-card2 text-soft" : "hover:text-soft"}`}><Icon name="folder" size={12} />File explorer</button>
        <button onClick={() => setComposer(!composer)} className={`flex items-center gap-1.5 rounded px-2 py-1 ${composer ? "bg-card2 text-soft" : "hover:text-soft"}`}><Icon name="pencil" size={12} />Rich input <kbd className="text-dim">⌘J</kbd></button>
        <span className="ml-auto min-w-0 truncate text-dim">{shortPath(cwd)}</span>
        {git && <button onClick={() => terminalAction("changes")} className="flex items-center gap-1.5 rounded border border-edge2 px-2 py-0.5"><Icon name="branch" size={11} />{git.branch}</button>}
        {needsReview && <button onClick={() => setPanel("changes")} className="text-orange">Needs review</button>}
      </footer>
    </div>
    {panel === "changes" && <div className="terminal-side-panel workbench-chrome flex min-h-0"><ChangesPanel cwd={cwd} session={session} onClose={() => setPanel(undefined)} /></div>}
    {filesVisited && <div style={panel === "files" ? undefined : { display: "none" }} className="terminal-side-panel workbench-chrome flex min-h-0"><FileExplorer cwd={cwd} onClose={() => setPanel(undefined)} /></div>}
  </div>;
}
