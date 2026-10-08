import { useEffect, useRef, useState } from "react";
import { layerColors, type TabLayer } from "../../../shared/settings.js";
import { Icon } from "../board/icons.js";

export function colorStyle(color?: string): { background: string } | undefined {
  return color ? { background: `var(--color-${color})` } : undefined;
}

const newLayerId = (): string => `layer-${Date.now().toString(36)}`;

export function LayerStrip({ layers, activeLayer, counts, paused, waiting, onSwitch, onDropTab, onChange, onCloseLayer }: {
  layers: TabLayer[];
  activeLayer: string;
  /** How many tabs sit in each layer, by layer id. */
  counts: Record<string, number>;
  /** How many of those are waiting paused, by layer id. */
  paused: Record<string, number>;
  onSwitch: (id: string) => void;
  /** A tab dragged onto a layer pill moves there. */
  onDropTab: (termId: string, layer: string) => void;
  onChange: (layers: TabLayer[], activeLayer: string) => void;
  /** Agents waiting on the user in each layer, by layer id. */
  waiting: Record<string, number>;
  /** Closes every terminal in a layer. Deleting one without this leaves its
   *  tabs running and silently folded into the first layer. */
  onCloseLayer: (id: string) => void;
}): React.JSX.Element {
  const [menu, setMenu] = useState<string>();
  const [renaming, setRenaming] = useState<string>();
  const [name, setName] = useState("");
  const [over, setOver] = useState<string>();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(undefined); };
    window.addEventListener("mousedown", dismiss);
    return () => window.removeEventListener("mousedown", dismiss);
  }, [menu]);

  const pausedHere = (id: string): number => paused[id] ?? 0;

  const add = (): void => {
    const layer = { id: newLayerId(), name: `Layer ${layers.length + 1}` };
    onChange([...layers, layer], layer.id);
    setName(layer.name);
    setRenaming(layer.id);
  };
  const rename = (id: string, value: string): void => {
    onChange(layers.map((layer) => layer.id === id ? { ...layer, name: value.trim() || layer.name } : layer), activeLayer);
    setRenaming(undefined);
  };
  // Deck always has a layer, so clearing the last one leaves an empty one
  // rather than a window with nowhere to put a terminal.
  const remove = (id: string): void => {
    const rest = layers.filter((layer) => layer.id !== id);
    const next = rest.length ? rest : [{ id: newLayerId(), name: "Layer 1" }];
    onChange(next, rest.length && activeLayer !== id ? activeLayer : next[0].id);
  };
  const closeLayer = (id: string): void => { onCloseLayer(id); remove(id); };

  return <div role="tablist" aria-label="Layers" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-edge px-2 py-1.5">
    {layers.map((layer) => {
      const active = layer.id === activeLayer;
      return <div key={layer.id} className="group relative">
        {renaming === layer.id
          ? <input aria-label="Layer name" autoFocus value={name} onChange={(event) => setName(event.target.value)}
              onBlur={() => rename(layer.id, name)}
              onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") rename(layer.id, name); if (event.key === "Escape") setRenaming(undefined); }}
              className="w-24 rounded-full bg-bg px-2 py-0.5 text-[11px] text-ink outline-none" />
          : <button role="tab" aria-selected={active} title={pausedHere(layer.id) ? `${layer.name}: ${(counts[layer.id] ?? 0) - pausedHere(layer.id)} running, ${pausedHere(layer.id)} paused` : `${layer.name} (${counts[layer.id] ?? 0} tabs)`}
              onClick={() => onSwitch(layer.id)}
              onDoubleClick={() => { setName(layer.name); setRenaming(layer.id); }}
              onContextMenu={(event) => { event.preventDefault(); setMenu(layer.id); }}
              onDragOver={(event) => { if (event.dataTransfer.types.includes("text/deck-tab")) { event.preventDefault(); setOver(layer.id); } }}
              onDragLeave={() => setOver((id) => id === layer.id ? undefined : id)}
              onDrop={(event) => { event.preventDefault(); setOver(undefined); const termId = event.dataTransfer.getData("text/deck-tab"); if (termId) onDropTab(termId, layer.id); }}
              style={layer.color && (active || over === layer.id) ? {
                background: `color-mix(in srgb, var(--color-${layer.color}) 18%, transparent)`,
                borderColor: `var(--color-${layer.color})`,
              } : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${over === layer.id ? "border-accent text-soft" : active ? "border-edge3 bg-card2 text-soft" : "border-transparent text-mut hover:bg-card hover:text-body"}`}>
              {layer.color && <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={colorStyle(layer.color)} />}
              <span className="max-w-[9rem] truncate">{layer.name}</span>
              <span className="text-dim">{counts[layer.id] ?? 0}</span>
              {pausedHere(layer.id) > 0 && <span aria-hidden className="text-dim">{"\u23f8"}</span>}
              {waiting[layer.id] > 0 && <span aria-label={`${waiting[layer.id]} waiting`}
                className={`text-[10px] text-orange ${waiting[layer.id] > 1 ? "rounded-full bg-orange/20 px-1" : ""}`}>
                {waiting[layer.id] > 1 ? waiting[layer.id] : "\u25cf"}</span>}
            </button>}
        {renaming !== layer.id && <button aria-label={`Close ${layer.name} and its ${counts[layer.id] ?? 0} tab${(counts[layer.id] ?? 0) === 1 ? "" : "s"}`}
          title="Close the layer and its tabs" onClick={() => closeLayer(layer.id)}
          className="absolute -right-1 -top-1 hidden rounded-full border border-edge3 bg-overlay p-[3px] text-mut hover:text-red group-hover:block"><Icon name="x" size={8} /></button>}
        {menu === layer.id && <div ref={menuRef} role="menu" aria-label={`${layer.name} options`} className="absolute left-0 top-7 z-50 w-44 rounded-lg border border-edge3 bg-overlay p-1 shadow-xl">
          <button className="menu-item" onClick={() => { setMenu(undefined); setName(layer.name); setRenaming(layer.id); }}>Rename</button>
          <div className="flex gap-1 px-2 py-1.5">
            <button aria-label="No colour" title="No colour" onClick={() => { setMenu(undefined); onChange(layers.map((l) => l.id === layer.id ? { ...l, color: undefined } : l), activeLayer); }}
              className="h-4 w-4 rounded-full border border-edge3" />
            {layerColors.map((color) => <button key={color} aria-label={color} title={color} style={colorStyle(color)}
              onClick={() => { setMenu(undefined); onChange(layers.map((l) => l.id === layer.id ? { ...l, color } : l), activeLayer); }}
              className={`h-4 w-4 rounded-full ${layer.color === color ? "ring-2 ring-soft" : ""}`} />)}
          </div>
          <div className="my-1 border-t border-edge2" />
          <button className="menu-item" onClick={() => { setMenu(undefined); remove(layer.id); }}>Delete layer, keep its tabs</button>
          <button className="menu-item text-red" onClick={() => { setMenu(undefined); closeLayer(layer.id); }}>Close layer and its {counts[layer.id] ?? 0} tab{(counts[layer.id] ?? 0) === 1 ? "" : "s"}</button>
        </div>}
      </div>;
    })}
    <button aria-label="New layer" title="New layer" onClick={add} className="rounded-full px-1.5 py-0.5 text-mut hover:bg-card hover:text-ink"><Icon name="plus" size={12} /></button>
  </div>;
}
