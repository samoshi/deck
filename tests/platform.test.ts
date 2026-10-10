import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(process, "platform", { value: "win32" });
  process.env.DECK_WSL = "1";
});
vi.mock("node:child_process", () => ({ execFileSync: () => "archlinux\n/home/me\n" }));

const { agentProcess, expandHome, forwardToWsl, homeDir, loginShell, toWindowsPath, toWslPath } = await import("../src/main/platform.js");

describe("platform on Windows", () => {
  it("maps WSL paths to Windows ones", () => {
    expect(toWindowsPath("/mnt/e/Main/Programming")).toBe("E:\\Main\\Programming");
    expect(toWindowsPath("/mnt/c")).toBe("C:\\");
    expect(toWindowsPath("/home/me/.claude")).toBe("\\\\wsl.localhost\\archlinux\\home\\me\\.claude");
    expect(toWindowsPath("E:\\already")).toBe("E:\\already");
  });

  it("maps Windows paths back into WSL", () => {
    expect(toWslPath("E:\\Main\\Programming")).toBe("/mnt/e/Main/Programming");
    expect(toWslPath("E:\\")).toBe("/mnt/e");
    expect(toWslPath("\\\\wsl.localhost\\archlinux\\home\\me")).toBe("/home/me");
    expect(toWslPath("\\\\wsl$\\archlinux\\tmp")).toBe("/tmp");
    expect(toWslPath("/home/me")).toBe("/home/me");
  });

  it("round-trips a path through both directions", () => {
    for (const p of ["/mnt/d/a b/c", "/home/me/src/deck", "/"]) expect(toWslPath(toWindowsPath(p))).toBe(p);
  });

  it("finds home inside WSL and expands ~ there", () => {
    expect(homeDir()).toBe("\\\\wsl.localhost\\archlinux\\home\\me");
    expect(expandHome("~/.codex")).toBe("\\\\wsl.localhost\\archlinux\\home\\me\\.codex");
    expect(expandHome("/mnt/e/x")).toBe("E:\\x");
  });

  it("runs commands and agents through wsl.exe in the Linux cwd", () => {
    expect(loginShell("command -v claude", "E:\\repo")).toEqual(["wsl.exe", ["-d", "archlinux", "--cd", "/mnt/e/repo", "-e", "bash", "-lic", "command -v claude"]]);
    expect(agentProcess("/home/me/.local/bin/claude", ["-p", '{"a":1}'], "E:\\repo")).toEqual(["wsl.exe", ["-d", "archlinux", "--cd", "/mnt/e/repo", "-e", "/home/me/.local/bin/claude", "-p", '{"a":1}']]);
  });

  it("forwards Deck's variables into WSL without dropping existing ones", () => {
    expect(forwardToWsl({ WSLENV: "FOO/p" }, ["DECK_PORT"]).WSLENV).toBe("FOO/p:DECK_PORT/u");
  });
});
