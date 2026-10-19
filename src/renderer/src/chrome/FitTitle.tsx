import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ShortTitle } from "../../../main/titles.js";

/** The model-made names for `text`, keyed so a changed text is named afresh. */
export function useShortTitle(key: string | undefined, text: string | undefined): ShortTitle | undefined {
  const [title, setTitle] = useState<ShortTitle>();
  useEffect(() => {
    setTitle(undefined);
    if (!key || !text?.trim()) return;
    let live = true;
    void window.deck.titles.get(key, text).then((named) => { if (live && named) setTitle(named); });
    const off = window.deck.titles.onChanged((changed, named) => { if (changed === key) setTitle(named); });
    return () => { live = false; off(); };
  }, [key, text]);
  return title;
}

/** Shows the longest of `options` that fits the width it is given, so a wide
 *  sidebar reads the fuller name and a narrow one the short form rather than
 *  either ending in an ellipsis. The last option truncates if nothing fits. */
export function FitText({ options, className, title }: { options: string[]; className?: string; title?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [pick, setPick] = useState(0);
  const key = options.join("\n");
  useLayoutEffect(() => {
    const measure = () => {
      const width = box.current?.clientWidth ?? 0;
      if (!probe.current || !width) return;
      const fits = options.findIndex((option) => { probe.current!.textContent = option; return probe.current!.offsetWidth <= width; });
      setPick(fits < 0 ? options.length - 1 : fits);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, [key]);
  return <span ref={box} title={title} className={`relative block truncate ${className ?? ""}`}>
    {options[pick] ?? options.at(-1)}
    <span ref={probe} aria-hidden className="invisible absolute left-0 top-0 whitespace-nowrap" />
  </span>;
}
