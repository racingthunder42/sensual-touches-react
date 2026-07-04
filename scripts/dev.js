import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const viteEntry = path.join(
  projectRoot,
  "node_modules",
  "vite",
  "bin",
  "vite.js",
);

const processes = [
  spawn(process.execPath, [viteEntry, "--host", "127.0.0.1"], {
    cwd: projectRoot,
    stdio: "inherit",
  }),
  spawn(process.execPath, ["--watch", "server/index.js"], {
    cwd: projectRoot,
    stdio: "inherit",
  }),
];

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of processes) {
    if (!child.killed) child.kill();
  }
  process.exitCode = exitCode;
}

for (const child of processes) {
  child.on("exit", (code, signal) => {
    if (!shuttingDown && code !== 0 && signal !== "SIGTERM") {
      shutdown(code || 1);
    }
  });
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
