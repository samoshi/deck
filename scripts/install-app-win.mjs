// Windows counterpart of install-app.mjs: installs the built app into
// %LOCALAPPDATA%\Programs\Deck with a Start menu shortcut, so the Deck you use
// day to day is this checkout.
//
// A running Deck.exe is locked, and so is the pty host, which is Deck.exe run
// as plain Node. Both have to stop before the swap, which ends every terminal,
// including the one this may have been started from. So the swap is handed to
// a PowerShell that outlives this process: it waits for Deck to close,
// replaces the folder, and starts Deck again if it was running. It is started
// through WMI rather than as a detached child, because a terminal's job object
// (or WSL interop's) kills every descendant when it closes, detached or not.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  console.error("install-app-win.mjs runs on Windows; use install-app.mjs on macOS.");
  process.exit(1);
}

const root = path.dirname(import.meta.dirname);
const built = path.join(root, "dist", "win-unpacked");
if (!existsSync(path.join(built, "Deck.exe"))) {
  console.error("No built app found. Run `npm run build && npx electron-builder --win dir` first.");
  process.exit(1);
}

const target = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Programs", "Deck");
const shortcut = path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Deck.lnk");
const running = execFileSync("tasklist", ["/FI", "IMAGENAME eq Deck.exe", "/NH"], { encoding: "utf8" }).includes("Deck.exe");

const quote = (s) => `'${s.replace(/'/g, "''")}'`;
const log = path.join(os.tmpdir(), "deck-install.log");
const script = `
Start-Transcript -Path ${quote(log)} | Out-Null
$ErrorActionPreference = 'Stop'
$target = ${quote(target)}
Get-Process Deck -ErrorAction SilentlyContinue | Stop-Process -Force
for ($i = 0; $i -lt 40 -and (Get-Process Deck -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 250 }
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
Copy-Item -Recurse ${quote(built)} $target
$link = (New-Object -ComObject WScript.Shell).CreateShortcut(${quote(shortcut)})
$link.TargetPath = Join-Path $target 'Deck.exe'
$link.WorkingDirectory = $target
$link.Save()
${running ? "Start-Process (Join-Path $target 'Deck.exe')" : ""}
Write-Output "installed to $target"
Stop-Transcript | Out-Null
`;
const file = path.join(os.tmpdir(), "deck-install.ps1");
writeFileSync(file, script);

if (running) console.log("Deck is running: it will close (ending its terminals) and reopen once installed.");
const commandLine = `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${file}"`;
execFileSync("powershell.exe", ["-NoProfile", "-Command",
  `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${quote(commandLine)} } | Out-Null`], { stdio: "inherit" });
console.log(`installing ${path.relative(root, built)} to ${target} (log: ${log})`);
