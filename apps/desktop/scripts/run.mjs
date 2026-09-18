// Starts the unpackaged app: `node scripts/run.mjs [--dev-url=http://localhost:5173] [--directory-url=http://localhost:3100]`.
// Editors built on Electron (VS Code) export ELECTRON_RUN_AS_NODE=1 into their terminals; with it set, Electron behaves like
// plain Node and `require("electron").app` is undefined. It is removed here, so `pnpm dev:desktop` works from such a terminal.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron"); // path of the binary
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [root, ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
