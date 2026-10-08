import type { AgentLaunch } from "../../../shared/agents.js";
// Minimal cross-view event bus: lets search (or later, the board) open a
// terminal tab without threading callbacks through the whole tree.

export interface OpenTabDetail extends AgentLaunch {
  cwd?: string;
  command?: string;
  issueKey?: string;
  sessionId?: string;
}

// Mouse/keyboard "back": overlays get first refusal (they call
// preventDefault when they consume it), then the view history moves.
const NAV_BACK = "deck:nav-back";

export function requestNavBack(): boolean {
  return !window.dispatchEvent(new CustomEvent(NAV_BACK, { cancelable: true }));
}

export function onNavBack(cb: (e: Event) => void): () => void {
  window.addEventListener(NAV_BACK, cb);
  return () => window.removeEventListener(NAV_BACK, cb);
}

const OPEN_TAB = "deck:open-tab";

export function openTerminalTab(detail: OpenTabDetail): void {
  window.dispatchEvent(new CustomEvent(OPEN_TAB, { detail }));
}

export function onOpenTerminalTab(cb: (detail: OpenTabDetail) => void): () => void {
  const listener = (e: Event) => cb((e as CustomEvent<OpenTabDetail>).detail);
  window.addEventListener(OPEN_TAB, listener);
  return () => window.removeEventListener(OPEN_TAB, listener);
}

const OPEN_PR = "deck:open-pr";

export interface OpenPrDetail {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  isDraft: boolean;
  updatedAt: string;
}

export function openPullRequest(detail: OpenPrDetail): void {
  window.dispatchEvent(new CustomEvent(OPEN_PR, { detail }));
}

export function onOpenPullRequest(cb: (detail: OpenPrDetail) => void): () => void {
  const listener = (e: Event) => cb((e as CustomEvent<OpenPrDetail>).detail);
  window.addEventListener(OPEN_PR, listener);
  return () => window.removeEventListener(OPEN_PR, listener);
}

// A resumed tab is a new terminal in an old tab's place, so whatever holds
// state against the terminal id (the pane layout) is told to follow it.
const PANE_RENAMED = "deck:pane-renamed";

export interface PaneRenamedDetail { from: string; to: string }

export function paneRenamed(from: string, to: string): void {
  window.dispatchEvent(new CustomEvent(PANE_RENAMED, { detail: { from, to } }));
}

export function onPaneRenamed(cb: (detail: PaneRenamedDetail) => void): () => void {
  const listener = (e: Event) => cb((e as CustomEvent<PaneRenamedDetail>).detail);
  window.addEventListener(PANE_RENAMED, listener);
  return () => window.removeEventListener(PANE_RENAMED, listener);
}

const ADOPT_PANE = "deck:adopt-pane";

/** Put a terminal that already exists into a split, rather than opening one. */
export interface AdoptPaneDetail { termId: string; towards: "up" | "down" | "left" | "right" }

export function adoptPane(detail: AdoptPaneDetail): void {
  window.dispatchEvent(new CustomEvent(ADOPT_PANE, { detail }));
}

export function onAdoptPane(cb: (detail: AdoptPaneDetail) => void): () => void {
  const listener = (e: Event) => cb((e as CustomEvent<AdoptPaneDetail>).detail);
  window.addEventListener(ADOPT_PANE, listener);
  return () => window.removeEventListener(ADOPT_PANE, listener);
}

const PANE_RELEASED = "deck:pane-released";

/** A tab has left this layer, so it also leaves the split it was part of. */
export function paneReleased(termId: string): void {
  window.dispatchEvent(new CustomEvent(PANE_RELEASED, { detail: termId }));
}

export function onPaneReleased(cb: (termId: string) => void): () => void {
  const listener = (e: Event) => cb((e as CustomEvent<string>).detail);
  window.addEventListener(PANE_RELEASED, listener);
  return () => window.removeEventListener(PANE_RELEASED, listener);
}
