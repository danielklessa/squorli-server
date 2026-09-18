// Builds the desktop app's native helper (Windows only): native/window-audio/main.cpp -> native/bin/win32-x64/squorli-window-audio.exe
// with the MSVC compiler of an installed Visual Studio / Build Tools (found through vswhere). The output is not committed:
// the release workflow runs this before packaging, developers run `pnpm --filter @squorli/desktop native` once.
// Without the helper the app still works; a screen share then only offers the whole system's audio (apps/desktop/AGENTS.md).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
if (process.platform !== "win32") { console.log("[native] nothing to build on this platform (the helper is Windows only)"); process.exit(0); }

const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft Visual Studio/Installer/vswhere.exe");
if (!existsSync(vswhere)) { console.error("[native] vswhere.exe not found: install Visual Studio or the Build Tools with the C++ workload"); process.exit(1); }
const vs = execFileSync(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8" }).trim();
const vcvars = join(vs, "VC/Auxiliary/Build/vcvars64.bat");
if (!vs || !existsSync(vcvars)) { console.error("[native] no Visual Studio installation with the x64 C++ tools found"); process.exit(1); }

const outDir = join(here, "bin/win32-x64");
const objDir = join(tmpdir(), "squorli-native-obj");
mkdirSync(outDir, { recursive: true }); mkdirSync(objDir, { recursive: true });
const source = join(here, "window-audio/main.cpp");
const exe = join(outDir, "squorli-window-audio.exe");
// A batch file keeps the quoting out of cmd's hands. Static runtime (/MT): the helper must start on a machine without the VC++ redistributable.
const batch = join(objDir, "build.cmd");
writeFileSync(batch, [
  "@echo off",
  `call "${vcvars}" >nul || exit /b 1`,
  `cl /nologo /std:c++17 /O2 /MT /EHsc /W3 /DUNICODE /D_UNICODE /Fo"${objDir}\\\\" /Fe"${exe}" "${source}" /link /SUBSYSTEM:CONSOLE mmdevapi.lib ole32.lib user32.lib`,
].join("\r\n"));
const result = spawnSync("cmd.exe", ["/d", "/c", batch], { stdio: "inherit" });
if (result.status !== 0 || !existsSync(exe)) { console.error("[native] build failed"); process.exit(1); }
console.log(`[native] ${exe}`);
