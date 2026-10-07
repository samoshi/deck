import type { RememberedTab } from "../../../shared/settings.js";
import type { TermTab } from "../store.js";

/** A tab deck wrote down last run but has no terminal for: it keeps its place
 *  in the list and waits to be resumed. */
export function pausedTab(tab: RememberedTab): TermTab {
  return {
    termId: tab.id,
    title: tab.title,
    customTitle: tab.customTitle,
    cwd: tab.cwd,
    agent: tab.agent as TermTab["agent"],
    sessionId: tab.sessionId,
    layerId: tab.layer,
    groupId: tab.group,
    paused: true,
  };
}

/** The tab list deck opens with. The remembered list holds the order deck last
 *  had, so it drives the merge: a terminal still running takes its own place,
 *  anything deck remembers but no longer has comes back paused, and a terminal
 *  that outlived the window without being remembered is appended. */
export function restoredTabs(live: TermTab[], remembered: RememberedTab[]): TermTab[] {
  const byId = new Map(live.map((tab) => [tab.termId, tab]));
  const merged = remembered.map((tab) => byId.get(tab.id) ?? pausedTab(tab));
  const seen = new Set(remembered.map((tab) => tab.id));
  return [...merged, ...live.filter((tab) => !seen.has(tab.termId))];
}
