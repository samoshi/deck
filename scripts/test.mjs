import { spawnSync } from "node:child_process";
import electron from "electron";

// Native dependencies are rebuilt for Electron by postinstall. Run tests
// under the same Node ABI without launching the desktop application.
const result = spawnSync(electron, ["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(2)], {
  stdio: "inherit",
  // DECK_WSL=0: on Windows, keep paths native (see src/main/platform.ts);
  // the suites that exercise the WSL bridge switch it back on themselves.
  env: { DECK_WSL: "0", ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
