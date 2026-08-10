import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { parse as parseDotenv } from "dotenv";

const root = path.resolve(import.meta.dirname, "..");
const localEnvironmentPath = path.join(root, ".env");
const localEnvironment = existsSync(localEnvironmentPath)
  ? parseDotenv(readFileSync(localEnvironmentPath, "utf8"))
  : {};
for (const [key, value] of Object.entries(localEnvironment)) {
  process.env[key] ??= value;
}
const project = process.argv[2] ?? "chromium";
const playwrightArguments = process.argv.slice(3);
const runLabel = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 6)}`;
const supportedProjects = new Set([
  "chromium",
  "accessibility",
  "w3",
  "w3-accessibility",
  "w3-evidence",
  "w3-provider-disabled",
  "w4",
  "w4-accessibility",
]);
if (!supportedProjects.has(project)) {
  throw new Error(`Unsupported Playwright project: ${project}`);
}
const isW3 = project.startsWith("w3");
const isW4 = project.startsWith("w4");
const usesWalletOperations = isW3 || isW4;
const providerDisabled = project === "w3-provider-disabled";

const logDirectory = path.join(root, "test-results", "waflo-logs");
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
    readyUrl: "http://127.0.0.1:3002/privacy",
    cwd: path.join(root, "apps", "customer-web"),
    entry: path.join(root, "apps", "customer-web", "node_modules", "next", "dist", "bin", "next"),
    args: ["start", "-p", "3002"],
  },
];
if (usesWalletOperations) {
  commands.push({
    name: "wallet-worker",
    port: null,
    readyUrl: null,
    cwd: path.join(root, "apps", "wallet-worker"),
    entry: path.join(root, "apps", "wallet-worker", "dist", "main.js"),
    args: [],
  });
}
if (isW4) {
  commands.push({
    name: "operational-worker",
    port: null,
    readyUrl: null,
    cwd: path.join(root, "apps", "operational-worker"),
    entry: path.join(root, "apps", "operational-worker", "dist", "main.js"),
    args: [],
  });
}

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
      ...(usesWalletOperations
        ? {
            APPLE_WALLET_MODE: providerDisabled ? "DISABLED" : "TEST_ADAPTER",
            GOOGLE_WALLET_MODE: providerDisabled ? "DISABLED" : "TEST_ADAPTER",
            GOOGLE_WALLET_ISSUER_ID: "test-issuer",
            REDIS_URL: "redis://127.0.0.1:6379",
          }
        : {}),
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
  if (!command.readyUrl) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if (child.exitCode !== null) {
      throw new Error(`${command.name} exited before readiness with code ${child.exitCode}.`);
    }
    return;
  }
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${command.name} exited before readiness with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(command.readyUrl, { redirect: "manual" });
      if (child.exitCode !== null) {
        throw new Error(`${command.name} exited before readiness with code ${child.exitCode}.`);
      }
      if (response.status === 200) return;
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
  if (children.length === 0) return;
  await Promise.all(children.map(stopChild));
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const portCommands = commands.filter((command) => command.port !== null);
    const states = await Promise.all(portCommands.map((command) => portIsOpen(command.port)));
    if (states.every((open) => !open)) {
      process.stdout.write(`Playwright ${project} cleanup: all managed ports closed.\n`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const openPorts = [];
  for (const command of commands) {
    if (command.port !== null && (await portIsOpen(command.port))) openPorts.push(command.port);
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
    if (command.port !== null && (await portIsOpen(command.port))) {
      throw new Error(
        `Port ${command.port} is already in use before Playwright starts (${command.name}).`,
      );
    }
  }
  for (const command of commands) {
    const child = spawnServer(command);
    await waitForReady(command, child);
  }
  const playwrightCli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
  const runner = spawn(
    process.execPath,
    [playwrightCli, "test", `--project=${project}`, ...playwrightArguments],
    {
      cwd: root,
      env: { ...process.env, WAFLO_MANAGED_SERVERS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
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
