import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentCommand, agentUpdateCommand, promptTitle, sessionAgent, sessionKey } from "../src/shared/agents.js";

describe("agent commands", () => {
  it("resumes each provider using its own CLI syntax and raw id", () => {
    expect(agentCommand({ agent: "codex", sessionId: "codex:abc" })).toBe("codex resume 'abc'");
    expect(agentCommand({ sessionId: "abc" })).toBe("claude --resume 'abc'");
    expect(sessionAgent(sessionKey("codex", "abc"))).toBe("codex");
  });
  it.skipIf(process.platform === "win32")("passes multiline prompts literally through a real shell", () => {
    const prompt = "-option 'quoted' \"double\" `pwd` $(pwd) $HOME\nsecond line";
    for (const agent of ["codex", "claude"] as const) {
      const command = agentCommand({ agent, prompt });
      const output = execFileSync("/bin/sh", ["-c", `${agent}() { printf '%s\\n' "$@"; }; ${command}`], { encoding: "utf8" });
      expect(output).toBe(`--\n${prompt}\n`);
    }
  });
});

describe("prompt titles", () => {
  it("drops the paste wrappers Claude Code adds and keeps the pasted text", () => {
    expect(promptTitle('worktree \n\n<pasted_content id="dab9">\nhttps://jira/INI-1\n</pasted_content>')).toBe("worktree https://jira/INI-1");
    expect(promptTitle("x".repeat(200))).toHaveLength(120);
  });
});

describe.skipIf(process.platform === "win32")("agent update before launch", () => {
  const run = (script: string, stubs: string) => ({ output: execFileSync("/bin/sh", ["-c", `${stubs}; ${script}; echo started`], { encoding: "utf8" }) });
  const stampDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "deck-stamp-"));

  it("upgrades the Homebrew cask, then starts the agent", () => {
    const stubs = "brew() { echo \"brew $*\"; }; claude() { echo claude-self-update; }";
    const { output } = run(agentUpdateCommand("claude", stampDir()), stubs);
    expect(output).toContain("brew upgrade --cask --quiet claude-code");
    expect(output).not.toContain("claude-self-update");
    expect(output.trim().endsWith("started")).toBe(true);
  });

  it("falls back to the CLI's own updater when the cask is not installed", () => {
    const stubs = "brew() { [ \"$1\" = list ] && return 1; echo brew-upgrade; }; npm() { echo \"npm $*\"; }";
    const { output } = run(agentUpdateCommand("codex", stampDir()), stubs);
    expect(output).toContain("npm install -g @openai/codex@latest");
    expect(output).not.toContain("brew-upgrade");
  });

  it("runs once per window, and a failed upgrade still starts the agent", () => {
    const dir = stampDir();
    const stubs = "brew() { [ \"$1\" = list ] && return 0; echo upgraded; return 1; }";
    expect(run(agentUpdateCommand("claude", dir), stubs).output).toContain("upgraded\nstarted");
    expect(run(agentUpdateCommand("claude", dir), stubs).output).not.toContain("upgraded");
    const sevenHoursAgo = new Date(Date.now() - 7 * 3600_000);
    fs.utimesSync(path.join(dir, "agent-update-claude"), sevenHoursAgo, sevenHoursAgo);
    expect(run(agentUpdateCommand("claude", dir), stubs).output).toContain("upgraded");
  });

  it("skips the upgrade on Ctrl-C and still starts the agent", async () => {
    const stubs = "brew() { [ \"$1\" = list ] && return 0; sh -c 'sleep 30 && echo upgraded'; }";
    const child = spawn("/bin/zsh", ["-c", `${stubs}; ${agentUpdateCommand("claude", stampDir())}; echo started`], { detached: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    await new Promise((resolve) => setTimeout(resolve, 500));
    process.kill(-child.pid!, "SIGINT");
    await new Promise((resolve) => child.on("exit", resolve));
    expect(output).toContain("started");
    expect(output).not.toContain("upgraded");
  });
});
