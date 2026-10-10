import { describe, expect, it } from "vitest";
import { parseLsofCwds, parseWslProbe } from "../src/main/ptyCwd.js";

describe("parseLsofCwds", () => {
  it("reads the cwd of every reported pid", () => {
    const cwds = parseLsofCwds("p412\nfcwd\nn/Users/me/www/deck\np413\nfcwd\nn/Users/me/www\n");
    expect(cwds.get(412)).toBe("/Users/me/www/deck");
    expect(cwds.get(413)).toBe("/Users/me/www");
  });

  it("keeps paths containing spaces and newline-free noise intact", () => {
    expect(parseLsofCwds("p7\nfcwd\nn/Users/me/My Projects/app\n").get(7)).toBe("/Users/me/My Projects/app");
  });

  it("ignores pids lsof could not inspect", () => {
    expect(parseLsofCwds("p1\np2\nfcwd\nn/tmp\n")).toEqual(new Map([[2, "/tmp"]]));
  });

  it("returns nothing for empty output", () => {
    expect(parseLsofCwds("")).toEqual(new Map());
  });
});

describe("parseWslProbe", () => {
  // id <TAB> cwd <TAB> /proc/<pid>/stat: pid (comm) state ppid pgrp session tty_nr tpgid ...
  const line = (id: string, cwd: string, pid: number, comm: string, ppid: number, tty: number, tpgid: number) =>
    `${id}\t${cwd}\t${pid} (${comm}) S ${ppid} ${pid} ${pid} ${tty} ${tpgid} 4194304 0`;

  it("reports the shell's cwd and the foreground process", () => {
    const states = parseWslProbe([
      line("t1", "/mnt/e/repo", 100, "bash", 1, 34816, 120),
      line("t1", "/mnt/e/repo/src", 120, "claude", 100, 34816, 120),
    ].join("\n"));
    expect(states.get("t1")).toEqual({ cwd: "/mnt/e/repo", foreground: "claude", shell: "bash" });
  });

  it("is idle when the shell holds its own terminal", () => {
    expect(parseWslProbe(line("t2", "/home/me", 200, "bash", 1, 34817, 200)).get("t2")).toEqual({ cwd: "/home/me", foreground: "bash", shell: "bash" });
  });

  it("skips a daemon the profile forked off without a tty", () => {
    const states = parseWslProbe([
      line("t3", "/", 90, "sysinfo-daemon", 1, 0, -1),
      line("t3", "/mnt/e/x", 300, "bash", 1, 34818, 300),
    ].join("\n"));
    expect(states.get("t3")?.cwd).toBe("/mnt/e/x");
  });

  it("keeps command names that contain spaces or parentheses", () => {
    expect(parseWslProbe(line("t4", "/tmp", 400, "my (odd) cmd", 1, 1, 400)).get("t4")?.shell).toBe("my (odd) cmd");
  });

  it("returns nothing for empty output", () => {
    expect(parseWslProbe("")).toEqual(new Map());
  });
});
