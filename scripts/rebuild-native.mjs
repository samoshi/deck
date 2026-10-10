// Rebuilds better-sqlite3 for Electron on postinstall. On Windows the source
// build needs Visual Studio's ClangCL toolset, which Node 24's headers ask
// for; the package already ships an N-API win32 prebuild that loads under any
// Electron ABI, so the rebuild is skipped there. npm's own implicit
// `node-gyp rebuild` for the package still fails without ClangCL, which is
// why Windows installs with `npm run setup:win` rather than `npm ci`.
import { execSync } from "node:child_process";

if (process.platform === "win32") {
  console.log("rebuild-native: using better-sqlite3's bundled win32 N-API prebuild");
  process.exit(0);
}
execSync("electron-rebuild -f -w better-sqlite3", { stdio: "inherit" });
