import { shellQuote } from "./platform.js";

export type Agent = "claude" | "codex";

export const agentLabels: Record<Agent, string> = { claude: "Claude", codex: "Codex" };

export function sessionKey(agent: Agent, id: string): string {
  return agent === "codex" && !id.startsWith("codex:") ? `codex:${id}` : id;
}

export function sessionAgent(id: string): Agent {
  return id.startsWith("codex:") ? "codex" : "claude";
}

/** The title a session takes from its first prompt. Claude Code wraps every
 *  paste in `<pasted_content>` tags; the tags go, the pasted text stays. */
export function promptTitle(prompt: string): string {
  return prompt.replace(/<\/?pasted_content[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export { shellQuote };

export interface AgentLaunch {
  agent?: Agent;
  sessionId?: string;
  prompt?: string;
}

export function agentCommand({ agent = "claude", sessionId, prompt }: AgentLaunch): string {
  const parts: string[] = [agent];
  if (sessionId) {
    const id = agent === "codex" ? sessionId.replace(/^codex:/, "") : sessionId;
    parts.push(agent === "codex" ? "resume" : "--resume", shellQuote(id));
  }
  if (prompt) parts.push("--", shellQuote(prompt));
  return parts.join(" ");
}

const agentPackages: Record<Agent, { cask: string; fallback: string }> = {
  claude: { cask: "claude-code", fallback: "claude update" },
  codex: { cask: "codex", fallback: "npm install -g @openai/codex@latest" },
};

/** Shell that upgrades an agent's CLI before it starts, at most once per
 *  `everyMinutes`. The stamp is touched before upgrading so tabs opened
 *  together run one upgrade between them. Ctrl-C interrupts only the
 *  upgrade, and a failed one never stops the agent from starting. */
export function agentUpdateCommand(agent: Agent, stampDir: string, everyMinutes = 360): string {
  const { cask, fallback } = agentPackages[agent];
  const stamp = shellQuote(`${stampDir}/agent-update-${agent}`);
  return [
    `if [ -z "$(find ${stamp} -mmin -${everyMinutes} 2>/dev/null)" ]; then`,
    `mkdir -p ${shellQuote(stampDir)}; touch ${stamp}; trap : INT;`,
    `printf '\\033[2mUpdating ${agentLabels[agent]} (Ctrl-C to skip)\\033[0m\\n';`,
    `if command -v brew >/dev/null 2>&1 && brew list --cask ${cask} >/dev/null 2>&1; then brew upgrade --cask --quiet ${cask}; else ${fallback}; fi;`,
    `trap - INT; fi`,
  ].join(" ");
}
