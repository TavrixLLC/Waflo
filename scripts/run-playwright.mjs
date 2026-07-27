import { createWriteStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const project = process.argv[2] ?? "chromium";
const runLabel = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 6)}`;
if (project !== "chromium" && project !== "accessibility") {
  throw new Error(`Unsupported Playwright project: ${project}`);
}

const logDirectory = path.join(root, "artifacts", "handoff-round-1", "raw-test-output");
await mkdir(logDirectory, { recursive: true });

const commands = [
  {
    name: "api",
    port: 4000,
    readyUrl: "http://127.0.0.1:4000/ready",
    cwd: path.join(root, "apps", "api"),
    entry: path.join(root, "apps", "api", "dist", "main.js"),
    args: [],
  },
  {
    name: "marketing",
    port: 3000,
    readyUrl: "http://127.0.0.1:3000/en",
    cwd: path.join(root, "apps", "marketing-web"),
    entry: path.join(root, "apps", "marketing-web", "node_modules", "next", "dist", "bin", "next"),
    args: ["start", "-p", "3000"],
  },
  {
    name: "dashboard",
    port: 3001,
    readyUrl: "http://127.0.0.1:3001/en/login",
    cwd: path.join(root, "apps", "merchant-dashboard"),
    entry: path.join(
      root,
      "apps",
      "merchant-dashboard",
      "node_modules",
      "next",
      "dist",
      "bin",
      "next",
    ),
    args: ["start", "-p", "3001"],
  },
  {
    name: "customer",
    port: 3002,
    readyUrl: "http://127.0.0.1:3002/?tenant=today",
    cwd: path.join(root, "apps", "customer-web"),
    entry: path.join(root, "apps", "customer-web", "node_modules", "next", "dist", "bin", "next"),
    args: ["start", "-p", "3002"],
  },
];

for (const command of commands) {
  if (!existsSync(command.entry)) {
    throw new Error(`Missing built server entry: ${command.entry}. Run pnpm build first.`);
  }
}

const children = [];
let cleanupStarted = false;

function spawnServer(command) {
  const log = createWriteStream(
    path.join(logDirectory, `playwright-${project}-${runLabel}-${command.name}.log`),
  );
  const child = spawn(process.execPath, [command.entry, ...command.args], {
    cwd: command.cwd,
    env: {
      ...process.env,
      RATE_LIMIT_NAMESPACE: `playwright-${project}-${randomUUID()}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push({ child, log, name: command.name, port: command.port });
  return child;
}

async function waitForReady(command, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${command.name} exited before readiness with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(command.readyUrl, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The server has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${command.name} did not become ready within 120 seconds.`);
}

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(250);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    const close = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once("error", close);
    socket.once("timeout", close);
  });
}

async function stopChild(entry) {
  if (entry.child.exitCode === null) {
    entry.child.kill("SIGTERM");
    const gracefulDeadline = Date.now() + 5_000;
    while (entry.child.exitCode === null && Date.now() < gracefulDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (entry.child.exitCode === null && process.platform === "win32") {
      const taskkill = spawn("taskkill.exe", ["/PID", String(entry.child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      await new Promise((resolve) => taskkill.once("exit", resolve));
    } else if (entry.child.exitCode === null) {
      entry.child.kill("SIGKILL");
    }
  }
  entry.log.end();
}

async function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  await Promise.all(children.map(stopChild));
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const states = await Promise.all(commands.map((command) => portIsOpen(command.port)));
    if (states.every((open) => !open)) {
      process.stdout.write(`Playwright ${project} cleanup: all managed ports closed.\n`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const openPorts = [];
  for (const command of commands) {
    if (await portIsOpen(command.port)) openPorts.push(command.port);
  }
  throw new Error(`Managed server cleanup left open ports: ${openPorts.join(", ")}.`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(130));
  });
}

let exitCode = 1;
try {
  for (const command of commands) {
    const child = spawnServer(command);
    await waitForReady(command, child);
  }
  const playwrightCli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
  const runner = spawn(process.execPath, [playwrightCli, "test", `--project=${project}`], {
    cwd: root,
    env: { ...process.env, WAFLO_MANAGED_SERVERS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const runnerLog = createWriteStream(
    path.join(logDirectory, `playwright-${project}-${runLabel}-results.log`),
  );
  runner.stdout.pipe(process.stdout);
  runner.stdout.pipe(runnerLog);
  runner.stderr.pipe(process.stderr);
  runner.stderr.pipe(runnerLog);
  exitCode = await new Promise((resolve, reject) => {
    runner.once("error", reject);
    runner.once("exit", (code) => resolve(code ?? 1));
  });
  runnerLog.end(`\nexit_code=${exitCode}\n`);
} finally {
  await cleanup();
}

process.exitCode = exitCode;
