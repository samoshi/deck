// What a session's tab name is made from. The first prompt alone names the
// first request ("read the brief"), not the work, so the name is made from the
// folder, branch and any zoom-out brief the session started from, plus the
// first and latest prompts, and made again as the session goes on.

/** Text the harness puts in the prompt stream (cross-session messages, command wrappers). */
export function isInjectedPrompt(prompt: string): boolean {
  const start = prompt.trimStart();
  return start.startsWith("<") && !start.startsWith("<pasted_content");
}

/** The prompt counts at which a session is named again. */
export function renameAt(count: number): boolean {
  return count === 1 || count === 3 || (count > 3 && (count - 3) % 8 === 0);
}

/** The `# heading` of a brief a SessionStart hook injected, from a transcript's opening lines. */
export function briefHeading(transcript: string): string | undefined {
  for (const line of transcript.split("\n").slice(0, 50)) {
    let attachment: { hookEvent?: string; stdout?: unknown } | undefined;
    try { attachment = JSON.parse(line)?.attachment; } catch { continue; }
    if (attachment?.hookEvent !== "SessionStart" || typeof attachment.stdout !== "string") continue;
    let context: unknown = attachment.stdout;
    try { context = JSON.parse(attachment.stdout)?.hookSpecificOutput?.additionalContext ?? ""; } catch { /* plain-text hook output */ }
    const heading = /^# (.+)$/m.exec(String(context))?.[1]?.trim();
    if (heading) return heading.slice(0, 200);
  }
  return undefined;
}

export interface TopicParts {
  folder?: string;
  branch?: string;
  brief?: string;
  first: string;
  /** The latest prompts, oldest first, not repeating `first`. */
  latest: string[];
}

export function topicSource({ folder, branch, brief, first, latest }: TopicParts): string {
  const clip = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 400);
  return [
    folder && `Folder: ${folder}${branch && !["main", "master", "HEAD"].includes(branch) ? ` (branch ${branch})` : ""}`,
    brief && `Started from a brief titled: ${clip(brief)}`,
    `First request: ${clip(first)}`,
    ...latest.map((prompt) => `Latest request: ${clip(prompt)}`),
  ].filter(Boolean).join("\n");
}
