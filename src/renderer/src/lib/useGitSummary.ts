import { useEffect, useState } from "react";
import type { GitSummary } from "../../../main/git.js";

export function useGitSummary(cwd?: string) {
  const [summary, setSummary] = useState<GitSummary | null>(null);
  useEffect(() => {
    setSummary(null);
    if (!cwd) return;
    let cancelled = false;
    const refresh = () => void window.deck.git.summary(cwd).then((next) => { if (!cancelled) setSummary(next); });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [cwd]);
  return summary;
}

export function shortPath(cwd?: string): string {
  if (!cwd) return "~";
  // On Windows, folders inside WSL arrive as \\wsl.localhost\<distro>\...;
  // show them the way the shell in the tab would.
  const wsl = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+(.*)$/i.exec(cwd);
  const posix = wsl ? wsl[1].replace(/\\/g, "/") || "/" : cwd;
  return posix.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
