import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

// A shell's working directory changes with every cd, and nothing in the pty
// protocol reports it. Reading it from the process itself keeps the terminal
// chrome (folder, branch, diff) honest without needing shell integration.

/** Parses `lsof -Fpn -a -d cwd` output into the cwd of each reported pid. */
export function parseLsofCwds(output: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1)) || undefined;
    else if (line.startsWith("n") && pid !== undefined) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

export async function readCwds(pids: number[]): Promise<Map<number, string>> {
  if (!pids.length) return new Map();
  if (process.platform !== "darwin") {
    const entries = await Promise.all(
      pids.map(async (pid) => [pid, await fs.readlink(`/proc/${pid}/cwd`).catch(() => "")] as const),
    );
    return new Map(entries.filter(([, cwd]) => cwd));
  }
  // lsof exits non-zero when it cannot inspect one of the pids, but still
  // prints the ones it could.
  const { stdout } = await exec("lsof", ["-a", "-d", "cwd", "-Fpn", "-p", pids.join(",")])
    .catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? "" }));
  return parseLsofCwds(stdout);
}

export interface WslTermState {
  cwd: string;
  /** Command name of the terminal's foreground process group leader. */
  foreground: string;
  /** Command name of the terminal's own shell. */
  shell: string;
}

// On Windows the pty's process is wsl.exe, which says nothing about what runs
// inside it. Every process a Deck terminal starts inherits DECK_TERM_ID, so one
// pass over /proc in the distro finds each terminal's shell, its cwd and the
// process holding the foreground.
const WSL_PROBE = `for f in $(grep -lsa DECK_TERM_ID= /proc/[0-9]*/environ); do
d=\${f%/environ}; id=$(tr '\\0' '\\n' < "$f" | grep -m1 '^DECK_TERM_ID=')
printf '%s\\t%s\\t%s\\n' "\${id#DECK_TERM_ID=}" "$(readlink "$d/cwd")" "$(cat "$d/stat")"
done 2>/dev/null`;

interface ProcRow { id: string; cwd: string; pid: number; comm: string; ppid: number; tty: number; tpgid: number }

/** Parses the probe's "id<TAB>cwd<TAB>/proc/pid/stat" lines into per-terminal state. */
export function parseWslProbe(output: string): Map<string, WslTermState> {
  const rows: ProcRow[] = [];
  for (const line of output.split("\n")) {
    const [id, cwd, stat] = line.split("\t");
    const close = stat?.lastIndexOf(")") ?? -1;
    if (!id || !stat || close < 0) continue;
    const [, ppid, , , tty, tpgid] = stat.slice(close + 2).split(" ").map(Number);
    rows.push({ id, cwd, pid: Number(stat.slice(0, stat.indexOf(" "))), comm: stat.slice(stat.indexOf("(") + 1, close), ppid, tty, tpgid });
  }
  const states = new Map<string, WslTermState>();
  for (const id of new Set(rows.map((row) => row.id))) {
    const procs = rows.filter((row) => row.id === id);
    const pids = new Set(procs.map((p) => p.pid));
    // The shell is the top of the tree, holding a tty; a daemon the profile
    // forked off with setsid also inherits the id but has none.
    const shell = procs.filter((p) => !pids.has(p.ppid) && p.tty !== 0).sort((a, b) => a.pid - b.pid)[0];
    if (!shell) continue;
    const foreground = procs.find((p) => p.pid === shell.tpgid) ?? shell;
    states.set(id, { cwd: shell.cwd, foreground: foreground.comm, shell: shell.comm });
  }
  return states;
}

export async function readWslTerms(distro: string): Promise<Map<string, WslTermState>> {
  const { stdout } = await exec("wsl.exe", ["-d", distro, "-e", "sh", "-c", WSL_PROBE], { timeout: 5000, windowsHide: true })
    .catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? "" }));
  return parseWslProbe(stdout);
}
