export type PaneLayout = { termId: string } | { direction: "row" | "column"; ratio: number; first: PaneLayout; second: PaneLayout };
export interface PaneRect { termId: string; left: number; top: number; width: number; height: number }

export function paneIds(layout: PaneLayout): string[] {
  return "termId" in layout ? [layout.termId] : [...paneIds(layout.first), ...paneIds(layout.second)];
}
/** `before` puts the new pane above or left of the target instead of below or
 *  right of it, which is what a split up or left means. */
export function splitPane(layout: PaneLayout, target: string, next: string, direction: "row" | "column", before = false): PaneLayout {
  if ("termId" in layout) {
    if (layout.termId !== target) return layout;
    return before ? { direction, ratio: 0.5, first: { termId: next }, second: layout } : { direction, ratio: 0.5, first: layout, second: { termId: next } };
  }
  return { ...layout, first: splitPane(layout.first, target, next, direction, before), second: splitPane(layout.second, target, next, direction, before) };
}
export function pruneLayout(layout: PaneLayout, live: Set<string>): PaneLayout | undefined {
  if ("termId" in layout) return live.has(layout.termId) ? layout : undefined;
  const first = pruneLayout(layout.first, live);
  const second = pruneLayout(layout.second, live);
  return first && second ? { ...layout, first, second } : first ?? second;
}

/** Stable leaf containers keep xterm mounted while layouts change. */
export function paneRects(layout: PaneLayout, area = { left: 0, top: 0, width: 100, height: 100 }): PaneRect[] {
  if ("termId" in layout) return [{ termId: layout.termId, ...area }];
  const ratio = Math.min(0.9, Math.max(0.1, layout.ratio));
  const first = layout.direction === "row" ? { ...area, width: area.width * ratio } : { ...area, height: area.height * ratio };
  const second = layout.direction === "row"
    ? { ...area, left: area.left + first.width, width: area.width - first.width }
    : { ...area, top: area.top + first.height, height: area.height - first.height };
  return [...paneRects(layout.first, first), ...paneRects(layout.second, second)];
}

export interface PaneDivider {
  path: ("first" | "second")[];
  direction: "row" | "column";
  ratio: number;
  area: Omit<PaneRect, "termId">;
}
export function paneDividers(layout: PaneLayout, area = { left: 0, top: 0, width: 100, height: 100 }, path: PaneDivider["path"] = []): PaneDivider[] {
  if ("termId" in layout) return [];
  const first = layout.direction === "row" ? { ...area, width: area.width * layout.ratio } : { ...area, height: area.height * layout.ratio };
  const second = layout.direction === "row" ? { ...area, left: area.left + first.width, width: area.width - first.width } : { ...area, top: area.top + first.height, height: area.height - first.height };
  return [{ path, direction: layout.direction, ratio: layout.ratio, area }, ...paneDividers(layout.first, first, [...path, "first"]), ...paneDividers(layout.second, second, [...path, "second"])];
}
export function resizePane(layout: PaneLayout, path: PaneDivider["path"], ratio: number): PaneLayout {
  if ("termId" in layout) return layout;
  if (!path.length) return { ...layout, ratio: Math.min(0.85, Math.max(0.15, ratio)) };
  const [child, ...remaining] = path;
  return { ...layout, [child]: resizePane(layout[child], remaining, ratio) };
}

export type PaneDirection = "up" | "down" | "left" | "right";

/** The split a direction makes: rows divide left from right, columns top from
 *  bottom, and up/left insert the new pane first. */
export const splitFor: Record<PaneDirection, { direction: "row" | "column"; before: boolean }> = {
  up: { direction: "column", before: true },
  down: { direction: "column", before: false },
  left: { direction: "row", before: true },
  right: { direction: "row", before: false },
};

/** The pane to focus when moving `direction` out of `from`: the nearest one
 *  that lies beyond that edge and still overlaps the current pane's span.
 *  Ratios are percentages, so the epsilon absorbs float drift in paneRects. */
export function paneInDirection(layout: PaneLayout, from: string, direction: PaneDirection): string | undefined {
  const rects = paneRects(layout);
  const current = rects.find((rect) => rect.termId === from);
  if (!current) return undefined;
  const epsilon = 0.01;
  const horizontal = direction === "left" || direction === "right";
  const gap = (rect: PaneRect) =>
    direction === "left" ? current.left - (rect.left + rect.width)
      : direction === "right" ? rect.left - (current.left + current.width)
        : direction === "up" ? current.top - (rect.top + rect.height)
          : rect.top - (current.top + current.height);
  const overlap = (rect: PaneRect) => horizontal
    ? Math.min(rect.top + rect.height, current.top + current.height) - Math.max(rect.top, current.top)
    : Math.min(rect.left + rect.width, current.left + current.width) - Math.max(rect.left, current.left);
  return rects
    .filter((rect) => rect.termId !== from && gap(rect) >= -epsilon && overlap(rect) > epsilon)
    .sort((a, b) => gap(a) - gap(b) || overlap(b) - overlap(a))[0]?.termId;
}

/** The share a zoomed pane takes of every split it sits in. Kept inside the
 *  bounds resizePane clamps to, so dragging a divider afterwards is smooth. */
export const ZOOM_RATIO = 0.85;

/** Grows every split on the way to `termId` so the focused pane fills most of
 *  the tab. Unlike WezTerm's zoom the other panes stay on screen, just small. */
export function zoomPane(layout: PaneLayout, termId: string, ratio = ZOOM_RATIO): PaneLayout {
  if ("termId" in layout) return layout;
  const inFirst = paneIds(layout.first).includes(termId);
  if (!inFirst && !paneIds(layout.second).includes(termId)) return layout;
  return { ...layout, ratio: inFirst ? ratio : 1 - ratio, first: zoomPane(layout.first, termId, ratio), second: zoomPane(layout.second, termId, ratio) };
}
