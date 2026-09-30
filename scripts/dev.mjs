import { spawn } from "node:child_process";

const processes = [
  { name: "server", args: ["node_modules/tsx/dist/cli.mjs", "watch", "server/index.ts"] },
  { name: "web", args: ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"] },
];
let stopping = false;
const children = processes.map(({ name, args }) => {
  const child = spawn(process.execPath, args, { stdio: ["inherit", "pipe", "pipe"], env: process.env });
  for (const stream of [child.stdout, child.stderr]) {
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) console.log(`[${name}] ${line}`);
    });
    stream.on("end", () => { if (pending) console.log(`[${name}] ${pending}`); });
  }
  child.on("error", (error) => {
    console.error(`[${name}] Could not start: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[${name}] exited (${signal || (code ?? "unknown")}); stopping the other process.`);
      stop(code || 1);
    }
  });
  return child;
});

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
  process.exitCode = exitCode;
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
