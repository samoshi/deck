import type { Keybinds } from "./keybinds.js";
import type { Agent } from "./agents.js";
import type { TerminalAppearanceSettings } from "./terminal.js";

// Settings shape shared between main and renderer. Everything user-tunable
// lives here — deck ships no hardcoded personal or company config.

/** Which issue tracker the board mirrors. Each is an adapter behind the same
 *  board interface; only the connection block for the chosen one is used. */
export type BoardProviderKind = "jira" | "linear" | "github";

export interface BoardSettings {
  provider: BoardProviderKind;
  /** Status names matching this (case-insensitive) get the rejected treatment. */
  rejectedPattern: string;
  /** How many days of Done issues stay on the board. */
  doneWindowDays: number;
  /** Board columns the reviews queue is built from when it is sourced from
   *  the board: every card sitting in one of these puts its open PRs in the
   *  queue. Unused when the queue comes from GitHub. */
  reviewColumns: string[];
  /** What happens to an issue when one of its PRs is merged from deck. */
  onMerge: OnMergeSettings;
}

export interface JiraSettings {
  baseUrl: string;
  email: string;
  apiToken: string;
  boardId: string;
}

export interface LinearSettings {
  apiKey: string;
  /** Team key as in issue identifiers, e.g. ENG for ENG-123. */
  teamKey: string;
}

export interface GithubProjectsSettings {
  /** Organisation or user that owns the project. */
  owner: string;
  /** The number in the project's URL. */
  projectNumber: string;
}

/** - "local": the card shows in the target column on deck's board only, until
 *    the tracker catches up (its own automation) or the issue moves elsewhere.
 *  - "remote": deck moves the issue in the tracker itself. */
export type OnMergeMode = "local" | "remote";

export interface OnMergeSettings {
  enabled: boolean;
  /** Board column the issue lands in. */
  column: string;
  mode: OnMergeMode;
}

/** Where the reviews queue gets its pull requests.
 *  - "github": every open PR GitHub has asked the user to review.
 *  - "board": the open PRs of the cards in the board's review columns,
 *    whether or not GitHub asked the user for a review. */
export type ReviewSource = "github" | "board";

/** Which sessions the agent page may be told about: every live one, those in
 *  the repository being worked in, or those under a listed project. */
export type SharingMode = "all" | "current" | "allowlist";

export interface AgentSharingSettings {
  mode: SharingMode;
  /** Directories whose sessions may be shared in "allowlist" mode. Supports ~;
   *  a session matches when its cwd is the directory or sits inside it. */
  projects: string[];
  /** Whether a shared session may also carry its last messages. */
  transcripts: boolean;
  /** Whether the cached issue board is shared at all. */
  board: boolean;
  /** Whether the pull request inbox is shared at all. */
  pullRequests: boolean;
}

export interface GithubSettings {
  /** Org/user that scopes PR search; empty searches all of GitHub. */
  owner: string;
  /** Narrows further to these repositories: names under the owner, or
   *  owner/name. Empty means every repository of the owner. */
  repos: string[];
}

/** Whether the hotkey shares the regular window (Dock, tray), gets a panel of
 *  its own onto the same tabs, or a panel that keeps its tabs to itself. */
export type WindowMode = "shared" | "panel" | "panel-own-tabs";

/** Which window a terminal was opened from. */
export type WindowRole = "main" | "panel";

/** What an agent does with a fix it prepared for one of the user's PRs.
 *  - "review": pauses with the diff for the user to approve the push.
 *  - "push": commits and pushes unattended. */
export type AutoFixPush = "review" | "push";

export interface AutoFixSettings {
  enabled: boolean;
  /** Start an agent when CI fails on one of the user's open PRs. */
  ci: boolean;
  /** Start an agent when one of the user's open PRs gets merge conflicts. */
  conflicts: boolean;
  push: AutoFixPush;
}

/** Where a new terminal starts.
 *  - "current": the active terminal's folder, falling back to `defaultCwd`.
 *  - "default": always `defaultCwd`. */
export type StartCwd = "current" | "default";

export interface NewTerminalCwdSettings {
  tab: StartCwd;
  split: StartCwd;
}

/** Features still being tried out. Each is off until switched on in settings. */
export interface ExperimentSettings {
  /** The session sweep: which pull requests each live agent session opened,
   *  with a close for the sessions whose pull requests are all merged. */
  sessionSweep: boolean;
}

/** What happens to the tabs deck remembered when it starts again.
 *  - "active": the layer you were last in comes back running; every other
 *    layer's tabs wait paused until you resume them.
 *  - "all": every layer's tabs come back running.
 *  - "paused": nothing starts on its own; every tab waits paused.
 *  - "off": deck forgets the tabs of a session once it quits. */
export type RestoreTabs = "active" | "all" | "paused" | "off";

/** The page deck opens on. */
export type DefaultView = "terminal" | "board" | "agent" | "reviews";

/** Models the orchestrator can run on: aliases claude accepts plus the full id where no alias exists. */
export const askModels = [
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
  { id: "haiku", label: "Haiku" },
] as const;

/** A layer: one exclusive set of the workspace's terminal tabs. Where a
 *  workspace separates clients, layers separate what you are doing for one;
 *  switching shows that layer's tabs and hides the rest. */
export interface TabLayer {
  id: string;
  name: string;
  /** Accent for the layer's pill; a theme colour name, empty for the default. */
  color?: string;
}

/** A named, collapsible run of tabs inside one layer. Unlike a layer, a group
 *  hides nothing: collapsing it folds its tabs into a header carrying their
 *  count, and they stay reachable by number and by the next/previous chords. */
export interface TabGroup {
  id: string;
  /** Layer the group sits in; a group never spans two. */
  layer: string;
  /** Group this one nests inside, which splitting a grouped tab makes. A
   *  subgroup never has children of its own, so the sidebar is two deep. */
  parent?: string;
  name: string;
  color?: string;
  collapsed?: boolean;
}

/** Colours a layer or group can be tinted with, as theme tokens so every
 *  theme picks its own shade. */
export const layerColors = ["accent", "blue", "green", "orange", "red"] as const;

/** Where a split's new tab belongs, given the group its source tab is in. A
 *  split nests: the pair gets a group of its own inside the source's. Once
 *  nesting is at the one level groups allow, the new tab joins the source's
 *  group instead of going deeper, so a split is never refused. */
export function splitPlacement(source: TabGroup | undefined): { join: string } | { parent?: string } {
  return source?.parent ? { join: source.id } : { parent: source?.id };
}

/** Un-nests stored groups that can no longer nest: ones whose parent is gone,
 *  sits in another layer, or is itself a subgroup. Keeping this at the edge
 *  means the sidebar can render two levels without guarding against a third. */
export function flattenGroups(groups: TabGroup[]): TabGroup[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  return groups.map((group) => {
    const parent = group.parent ? byId.get(group.parent) : undefined;
    return parent && !parent.parent && parent.layer === group.layer ? group : { ...group, parent: undefined };
  });
}

/** The settings that differ per client or company: which tracker and GitHub
 *  owner deck talks to, where the code lives. Everything else in DeckSettings
 *  is about deck itself and is shared by every workspace. */
export interface WorkspaceSettings {
  /** Where the reviews queue comes from; `board.reviewColumns` names the
   *  columns the board source reads. */
  reviewSource: ReviewSource;
  board: BoardSettings;
  jira: JiraSettings;
  linear: LinearSettings;
  githubProjects: GithubProjectsSettings;
  github: GithubSettings;
  /** Directories deck treats as repo roots (search fallbacks, repo pickers). */
  repoRoots: string[];
  /** Folder new terminals fall back to. Supports ~. */
  defaultCwd: string;
  /** The workspace's layers, in the order the sidebar lists them. Never empty. */
  layers: TabLayer[];
  /** Id of the layer whose tabs are on screen. */
  activeLayer: string;
  /** Tab groups across every layer, in sidebar order. */
  groups: TabGroup[];
}

export const workspaceKeys = ["reviewSource", "board", "jira", "linear", "githubProjects", "github", "repoRoots", "defaultCwd", "layers", "activeLayer", "groups"] as const satisfies readonly (keyof WorkspaceSettings)[];

export interface Workspace extends WorkspaceSettings {
  id: string;
  name: string;
}

/** Id the pre-workspace profile migrated into. */
export const legacyWorkspaceId = "default";

/** The workspace a terminal or session belongs to, given the id it was
 *  stamped with. Unstamped ones (from before workspaces existed) and ones
 *  stamped with a workspace since removed belong to the migrated workspace,
 *  or to the first one once that is gone too. */
export function workspaceOf(stamp: string | null | undefined, workspaces: Pick<Workspace, "id">[]): string {
  if (stamp && workspaces.some((w) => w.id === stamp)) return stamp;
  return (workspaces.find((w) => w.id === legacyWorkspaceId) ?? workspaces[0]).id;
}

/** One remembered tab: enough to show it paused and to bring it back exactly
 *  where it was. Written when the tab list changes, read on the next start. */
export interface RememberedTab {
  /** The terminal's id at the time, kept as a stable key for the paused row. */
  id: string;
  layer: string;
  group?: string;
  cwd?: string;
  agent?: string;
  /** Agent session the tab was running, resumed when it is unpaused. */
  sessionId?: string;
  /** What the sidebar called it, for the paused row's label. */
  title: string;
  /** A name the user typed, reapplied to the terminal that replaces it. */
  customTitle?: string;
}

/** Id of the layer a terminal belongs to, given the id it was stamped with.
 *  Unstamped terminals (opened before layers existed) and ones stamped with a
 *  layer since deleted fall to the workspace's first layer. */
export function layerOf(stamp: string | null | undefined, layers: Pick<TabLayer, "id">[]): string {
  return stamp && layers.some((layer) => layer.id === stamp) ? stamp : layers[0].id;
}

/** The default layer every workspace starts with, and the one a deleted
 *  layer's tabs fall back to when it is the only one left. */
export const defaultLayerId = "main";

export interface DeckSettings extends WorkspaceSettings {
  /** Every workspace, in the order the switcher lists them. Never empty. */
  workspaces: Workspace[];
  /** Id of the workspace the WorkspaceSettings fields above mirror. Writing
   *  one of those fields writes that workspace. */
  activeWorkspace: string;
  /** Shortcut overrides by command; missing commands use the defaults. */
  keybinds: Partial<Keybinds>;
  defaultAgent: Agent;
  /** Claude model alias or id used by deck's own orchestrator turns. */
  askModel: string;
  defaultView: DefaultView;
  /** Which remembered tabs come back running when deck starts. */
  restoreTabs: RestoreTabs;
  autoFix: AutoFixSettings;
  agentSharing: AgentSharingSettings;
  windowMode: WindowMode;
  /** Electron accelerator that summons/hides the window from anywhere. */
  summonHotkey: string;
  /** Master switch for the summon hotkey. */
  summonHotkeyEnabled: boolean;
  /** Whether the hotkey docks the window to the top of the screen (quake style). */
  summonDockToTop: boolean;
  /** Quake-style panel height as a fraction of the screen's work area. */
  summonHeightRatio: number;
  /** Hide a hotkey-summoned quake panel as soon as another app takes focus. */
  summonHideOnBlur: boolean;
  /** Keep Deck out of the Dock and Cmd-Tab; it lives in the tray and the hotkey. */
  hideFromDock: boolean;
  newTerminalCwd: NewTerminalCwdSettings;
  /** Built-in id, custom:<id>, or <plugin-id>:<theme-id>. */
  theme: string;
  /** One-off hints about shortcuts and features deck notices you could use. */
  showTips: boolean;
  /** Buttons the user adds to the sidebar footer. */
  customButtons: CustomButton[];
  /** Whether first-run setup has been through. Until then deck opens on it. */
  onboarded: boolean;
  terminalAppearance: TerminalAppearanceSettings;
  experiments: ExperimentSettings;
}

export const defaultWorkspaceSettings: WorkspaceSettings = {
  reviewSource: "github",
  board: {
    provider: "jira",
    rejectedPattern: "reject",
    doneWindowDays: 7,
    reviewColumns: [],
    onMerge: { enabled: false, column: "", mode: "local" },
  },
  jira: { baseUrl: "", email: "", apiToken: "", boardId: "" },
  linear: { apiKey: "", teamKey: "" },
  githubProjects: { owner: "", projectNumber: "" },
  github: { owner: "", repos: [] },
  repoRoots: [],
  defaultCwd: "~",
  layers: [{ id: "main", name: "Main" }],
  activeLayer: "main",
  groups: [],
};

/** A button the user puts in the sidebar footer. It runs one command. When
 *  `opensUrl` is set, the last URL the command prints is opened in the browser
 *  instead of being thrown away, which is how a button reaches a local tool
 *  whose address is not fixed. */
export interface CustomButton {
  id: string;
  label: string;
  /** An icon name; anything the sidebar does not know falls back to a dot. */
  icon: string;
  command: string;
  opensUrl: boolean;
}

export const defaultSettings: DeckSettings = {
  ...defaultWorkspaceSettings,
  workspaces: [{ id: "default", name: "Default", ...defaultWorkspaceSettings }],
  activeWorkspace: "default",
  keybinds: {},
  defaultAgent: "claude",
  askModel: "sonnet",
  defaultView: "terminal",
  restoreTabs: "active",
  autoFix: { enabled: false, ci: true, conflicts: true, push: "review" },
  agentSharing: { mode: "all", projects: [], transcripts: true, board: true, pullRequests: true },
  windowMode: "shared",
  summonHotkey: "Alt+Space",
  summonHotkeyEnabled: true,
  summonDockToTop: true,
  summonHeightRatio: 0.6,
  summonHideOnBlur: true,
  hideFromDock: false,
  newTerminalCwd: { tab: "current", split: "current" },
  theme: "dark",
  showTips: true,
  customButtons: [],
  onboarded: false,
  terminalAppearance: {
    fontFamily: "",
    fontSize: 13,
    fontWeight: "normal",
    fontWeightBold: "bold",
    lineHeight: 1,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: "block",
  },
  experiments: { sessionSweep: false },
};
