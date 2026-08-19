import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
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
const isolatedDatabase = process.env.WAFLO_ISOLATED_E2E === "1";
const databaseRequire = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
);
const { Client } = databaseRequire("pg");
const playwrightArguments = process.argv.slice(3);
const runLabel = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 6)}`;
const supportedProjects = new Set([
  "chromium",
  "accessibility",
  "design-review",
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

// Playwright clears test-results when the runner starts. Stage logs outside that
// directory, then copy them back after the run so CI can always upload them.
const runtimeLogDirectory = await mkdtemp(path.join(tmpdir(), "waflo-playwright-"));
const artifactLogDirectory = path.join(root, "test-results", "waflo-logs");
const isolatedDatabaseName = isolatedDatabase
  ? `waflo_test_p0_visual_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
      .replaceAll("-", "_")
      .slice(0, 63)
  : null;
let isolatedDatabaseAdminUrl = null;

function isolatedDatabaseUrls(name) {
  if (!/^waflo_test_[a-z0-9_]+$/.test(name)) throw new Error("Unsafe isolated database name.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for isolated E2E.");
  const admin = new URL(process.env.DATABASE_URL);
  admin.searchParams.delete("schema");
  const test = new URL(admin);
  test.pathname = `/${name}`;
  test.searchParams.set("schema", "public");
  return { admin: admin.toString(), test: test.toString() };
}

async function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function pnpmCommand(args) {
  if (process.platform !== "win32") return { command: "corepack", args: ["pnpm", ...args] };
  return {
    command: process.execPath,
    args: [
      path.resolve(path.dirname(process.execPath), "node_modules/corepack/dist/corepack.js"),
      "pnpm",
      ...args,
    ],
  };
}

async function prepareIsolatedDatabase() {
  if (!isolatedDatabaseName) return;
  const urls = isolatedDatabaseUrls(isolatedDatabaseName);
  isolatedDatabaseAdminUrl = urls.admin;
  const client = new Client({ connectionString: urls.admin });
  await client.connect();
  try {
    await client.query(
      `CREATE DATABASE "${isolatedDatabaseName}" TEMPLATE template0 ENCODING 'UTF8'`,
    );
  } finally {
    await client.end();
  }
  process.env.DATABASE_URL = urls.test;
  process.env.WAFLO_TEST_DATABASE_NAME = isolatedDatabaseName;
  process.env.WAFLO_TEST_RUN_ID = isolatedDatabaseName.slice("waflo_test_".length);
  const migrateCommand = pnpmCommand(["--filter", "@waflo/database", "migrate:deploy"]);
  const migrate = await runCommand(migrateCommand.command, migrateCommand.args, process.env);
  if (migrate !== 0) throw new Error(`Isolated database migration failed (${migrate}).`);
  const seedCommand = pnpmCommand(["--filter", "@waflo/database", "seed"]);
  const seed = await runCommand(seedCommand.command, seedCommand.args, process.env);
  if (seed !== 0) throw new Error(`Isolated database seed failed (${seed}).`);
}

async function cleanupIsolatedDatabase() {
  if (!isolatedDatabaseName || !isolatedDatabaseAdminUrl) return;
  const client = new Client({ connectionString: isolatedDatabaseAdminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${isolatedDatabaseName}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function buildIsolatedFrontends() {
  // `next build` must always execute in production mode, even when the local
  // developer .env intentionally sets NODE_ENV=development for the test servers.
  // Windows cannot reliably execute the pnpm symlink graph emitted in a Next
  // standalone directory. The isolated browser harness therefore builds the
  // ordinary production server artifact; release builds remain standalone.
  const isolatedBuildEnvironment = {
    ...process.env,
    NODE_ENV: "production",
    WAFLO_E2E_NEXT_START: "1",
  };
  const api = pnpmCommand(["--filter", "@waflo/api", "build"]);
  if ((await runCommand(api.command, api.args, isolatedBuildEnvironment)) !== 0)
    throw new Error("Isolated API build failed.");
  // Workspace packages export compiled JavaScript to Next. Build the shared
  // interface registry before its browser consumers so an isolated run never
  // uses stale locale metadata from dist/.
  const i18n = pnpmCommand(["--filter", "@waflo/i18n", "build"]);
  if ((await runCommand(i18n.command, i18n.args, isolatedBuildEnvironment)) !== 0)
    throw new Error("Isolated i18n build failed.");
  // The shared control system is also consumed through its compiled export.
  // Rebuild it here so browser assertions exercise the current UI primitive.
  const ui = pnpmCommand(["--filter", "@waflo/ui", "build"]);
  if ((await runCommand(ui.command, ui.args, isolatedBuildEnvironment)) !== 0)
    throw new Error("Isolated UI build failed.");
  const build = pnpmCommand(["--filter", "@waflo/merchant-dashboard", "build"]);
  if ((await runCommand(build.command, build.args, isolatedBuildEnvironment)) !== 0)
    throw new Error("Isolated Merchant build failed.");
  const customer = pnpmCommand(["--filter", "@waflo/customer-web", "build"]);
  if ((await runCommand(customer.command, customer.args, isolatedBuildEnvironment)) !== 0)
    throw new Error("Isolated Customer build failed.");
}

const commands = [
  {
    name: "api",
    port: 4000,
    readyUrl: "http://127.0.0.1:4000/health",
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
    frontend: true,
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
    frontend: true,
  },
  {
    name: "customer",
    port: 3002,
    readyUrl: "http://127.0.0.1:3002/privacy",
    cwd: path.join(root, "apps", "customer-web"),
    entry: path.join(root, "apps", "customer-web", "node_modules", "next", "dist", "bin", "next"),
    args: ["start", "-p", "3002"],
    frontend: true,
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

const children = [];
let cleanupStarted = false;

function spawnServer(command) {
  const log = createWriteStream(
    path.join(runtimeLogDirectory, `playwright-${project}-${runLabel}-${command.name}.log`),
  );
  const child = spawn(process.execPath, [command.entry, ...command.args], {
    cwd: command.cwd,
    env: {
      ...process.env,
      ...(command.port !== null ? { PORT: String(command.port) } : {}),
      ...(command.frontend ? { NODE_ENV: "production", WAFLO_E2E_NEXT_START: "1" } : {}),
      ...(command.name === "dashboard" && process.env.NEXT_PUBLIC_API_URL
        ? { WAFLO_E2E_API_URL: process.env.NEXT_PUBLIC_API_URL }
        : {}),
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
  if (!entry.log.closed) {
    await new Promise((resolve, reject) => {
      entry.log.once("error", reject);
      entry.log.end(resolve);
    });
  }
}

let logsPreserved = false;
async function preserveLogs() {
  if (logsPreserved) return;
  logsPreserved = true;
  await mkdir(artifactLogDirectory, { recursive: true });
  await cp(runtimeLogDirectory, artifactLogDirectory, { recursive: true, force: true });
  await rm(runtimeLogDirectory, { recursive: true, force: true });
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
    void cleanup()
      .then(preserveLogs)
      .finally(() => process.exit(130));
  });
}

let exitCode = 1;
try {
  await prepareIsolatedDatabase();
  if (isolatedDatabase) {
    const apiPort = await freePort();
    process.env.API_PORT = String(apiPort);
    // The dashboard is served from localhost. Keep the browser-facing API
    // origin on that same site so the strict CSRF cookie is sent; the API
    // readiness probe remains explicitly loopback-bound.
    process.env.NEXT_PUBLIC_API_URL = `http://localhost:${apiPort}`;
    // Customer Web server components call the API directly. Keep that internal
    // hop on this run's isolated loopback port while browser requests retain
    // the same-site localhost origin above for cookie and CSRF coverage.
    process.env.API_INTERNAL_URL = `http://127.0.0.1:${apiPort}`;
    process.env.WAFLO_API_DB_PROBE_FILE = path.join(runtimeLogDirectory, "api-db-probe.json");
    commands[0].port = apiPort;
    commands[0].readyUrl = `http://127.0.0.1:${apiPort}/ready`;
    // Browser coverage deliberately traverses all three product hosts by their
    // stable localhost origins. Keep those ports fixed and verify they are free
    // before starting; only the API endpoint is isolated per test run.
    await buildIsolatedFrontends();
  }
  for (const command of commands) {
    if (!existsSync(command.entry)) {
      throw new Error(`Missing built server entry: ${command.entry}. Run pnpm build first.`);
    }
  }
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
  const runnerLog = createWriteStream(
    path.join(runtimeLogDirectory, `playwright-${project}-${runLabel}-results.log`),
  );
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
  children.push({ child: runner, log: runnerLog, name: "playwright", port: null });
  runner.stdout.pipe(process.stdout);
  runner.stdout.pipe(runnerLog);
  runner.stderr.pipe(process.stderr);
  runner.stderr.pipe(runnerLog);
  exitCode = await new Promise((resolve, reject) => {
    runner.once("error", reject);
    runner.once("exit", (code) => resolve(code ?? 1));
  });
  runnerLog.write(`\nexit_code=${exitCode}\n`);
} finally {
  await cleanup();
  await preserveLogs();
  await cleanupIsolatedDatabase();
}

process.exitCode = exitCode;
