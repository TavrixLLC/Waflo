import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const FULL = "FULL";
const SAFE_SCOPES = new Set(["MARKETING", "MERCHANT", "API"]);
const IMAGE_TARGETS = {
  MARKETING: ["marketing-staging"],
  MERCHANT: ["merchant-staging"],
  API: ["api"],
  FULL: [
    "migrate",
    "api",
    "apple-pass-builder",
    "operational-worker",
    "wallet-worker",
    "merchant-staging",
    "customer-staging",
    "admin-staging",
    "marketing-staging",
  ],
};

const WORKSPACE_ROOTS = ["apps", "packages", "deploy/vps/migrate"];
const ALWAYS_FULL_PATHS = [
  /^\.github\//u,
  /^deploy\//u,
  /(^|\/)Dockerfile$/u,
  /(^|\/)package\.json$/u,
  /(^|\/)docker-bake\.hcl$/u,
  /(^|\/)compose(?:\.[^/]+)?\.ya?ml$/u,
  /^scripts\/(?:w3-secret-scan|check-production-audit|run-playwright|run-isolated-vitest|release-)/u,
  /^packages\/(?:billing|config|contracts|database|security|auth|customer-security|external-auth-security)\//u,
  /^packages\/(?:wallet-[^/]+|stamp-engine|qr-core)\//u,
  /^apps\/(?:wallet-worker|operational-worker|apple-pass-builder-service)\//u,
  /^apps\/api\/(?:.*(?:billing|payments?|stripe|checkout|subscriptions?|wallet|auth|security)|prisma)\//u,
  /^apps\/merchant-dashboard\/(?:components\/onboarding|.*(?:billing|stripe|payment|checkout|subscription))(?:[/.]|$)/u,
  /(^|\/)(?:prisma|migrations?)(?:\/|$)/u,
];
const ROOT_FULL_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.base.json",
  ".npmrc",
  ".node-version",
  ".tool-versions",
]);

function normalizePath(input) {
  if (typeof input !== "string") throw new Error("Changed file path must be a string.");
  const normalized = input.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../")) {
    throw new Error("Changed file path is not repository-relative.");
  }
  return normalized;
}

function readWorkspaceGraph(root) {
  const byDirectory = new Map();
  const dependencies = new Map();
  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const absoluteRoot = path.join(root, workspaceRoot);
    if (!existsSync(absoluteRoot)) continue;
    const directories = workspaceRoot === "deploy/vps/migrate" ? [""] : readdirSync(absoluteRoot);
    for (const child of directories) {
      const relativeDirectory =
        workspaceRoot === "deploy/vps/migrate" ? workspaceRoot : `${workspaceRoot}/${child}`;
      const manifestPath = path.join(root, relativeDirectory, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (typeof manifest.name !== "string") continue;
      byDirectory.set(relativeDirectory, manifest.name);
      const dependencyNames = new Set();
      for (const section of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ]) {
        for (const [name, version] of Object.entries(manifest[section] ?? {})) {
          if (typeof version === "string" && version.startsWith("workspace:"))
            dependencyNames.add(name);
        }
      }
      dependencies.set(manifest.name, [...dependencyNames].sort());
    }
  }
  return { byDirectory, dependencies };
}

function workspaceForFile(file, graph) {
  const matchingDirectory = [...graph.byDirectory.keys()]
    .filter((directory) => file === directory || file.startsWith(`${directory}/`))
    .sort((left, right) => right.length - left.length)[0];
  return matchingDirectory ? graph.byDirectory.get(matchingDirectory) : null;
}

function dependencyClosure(workspace, graph) {
  const seen = new Set();
  const queue = [workspace];
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const dependency of graph.dependencies.get(current) ?? []) queue.push(dependency);
  }
  return [...seen].sort();
}

function scopeForWorkspace(workspace) {
  if (workspace === "@waflo/marketing-web") return "MARKETING";
  if (workspace === "@waflo/merchant-dashboard") return "MERCHANT";
  if (workspace === "@waflo/api") return "API";
  return null;
}

function full(reason, changedFiles = [], graph = { dependencies: new Map() }) {
  return {
    scope: FULL,
    reason,
    changedFiles,
    affectedWorkspaces: [],
    imageTargets: IMAGE_TARGETS.FULL,
    graph,
  };
}

/**
 * Classifies a concrete changed-file set using the checked-in pnpm workspace
 * manifests. Every parse or ownership ambiguity returns FULL rather than a
 * smaller validation path.
 */
export function classifyReleaseChanges(inputFiles, { root = process.cwd(), graph } = {}) {
  let workspaceGraph;
  let changedFiles;
  try {
    if (!Array.isArray(inputFiles) || inputFiles.length === 0) {
      return full("no changed files could be established");
    }
    changedFiles = [...new Set(inputFiles.map(normalizePath))].sort();
    workspaceGraph = graph ?? readWorkspaceGraph(root);
  } catch (error) {
    return full(`classifier input failure: ${error instanceof Error ? error.message : "unknown"}`);
  }

  const scopes = new Set();
  const workspaces = new Set();
  for (const file of changedFiles) {
    if (ROOT_FULL_FILES.has(file) || ALWAYS_FULL_PATHS.some((pattern) => pattern.test(file))) {
      return full(`critical or release-infrastructure path: ${file}`, changedFiles, workspaceGraph);
    }
    const workspace = workspaceForFile(file, workspaceGraph);
    const scope = workspace ? scopeForWorkspace(workspace) : null;
    if (!scope || !SAFE_SCOPES.has(scope)) {
      return full(`unclassified or shared path: ${file}`, changedFiles, workspaceGraph);
    }
    scopes.add(scope);
    workspaces.add(workspace);
  }

  if (scopes.size !== 1) {
    return full("multiple independent product domains changed", changedFiles, workspaceGraph);
  }
  const [scope] = scopes;
  const affectedWorkspaces = [...workspaces]
    .flatMap((workspace) => dependencyClosure(workspace, workspaceGraph))
    .filter((workspace, index, list) => list.indexOf(workspace) === index)
    .sort();
  return {
    scope,
    reason: `isolated ${scope.toLowerCase()} workspace change`,
    changedFiles,
    affectedWorkspaces,
    imageTargets: IMAGE_TARGETS[scope],
    graph: workspaceGraph,
  };
}

function isCommitSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
}

export function classifyReleaseRange({
  baseSha,
  headSha,
  root = process.cwd(),
  exec = execFileSync,
}) {
  if (!isCommitSha(baseSha) || !isCommitSha(headSha) || /^0{40}$/u.test(baseSha)) {
    return full("missing or untrusted release base SHA");
  }
  try {
    exec("git", ["cat-file", "-e", `${baseSha}^{commit}`], { cwd: root, stdio: "ignore" });
    exec("git", ["cat-file", "-e", `${headSha}^{commit}`], { cwd: root, stdio: "ignore" });
    const output = exec(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMRD", `${baseSha}...${headSha}`],
      { cwd: root, encoding: "utf8" },
    );
    return classifyReleaseChanges(output.split(/\r?\n/u).filter(Boolean), { root });
  } catch (error) {
    return full(
      `git range resolution failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

function writeGithubOutput(file, result, baseSha) {
  const outputs = [
    `scope=${result.scope}`,
    `reason=${result.reason.replaceAll(/[\r\n]/gu, " ")}`,
    `changed_files=${result.changedFiles.length}`,
    `affected_workspaces=${result.affectedWorkspaces.join(",")}`,
    `image_targets=${result.imageTargets.join(",")}`,
    `base_sha=${baseSha ?? ""}`,
  ];
  writeFileSync(file, `${outputs.join("\n")}\n`, "utf8");
}

function parseArguments(arguments_) {
  const result = {
    baseSha: undefined,
    headSha: undefined,
    githubOutput: undefined,
    forceFull: false,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--base") result.baseSha = arguments_[++index];
    else if (argument === "--head") result.headSha = arguments_[++index];
    else if (argument === "--github-output") result.githubOutput = arguments_[++index];
    else if (argument === "--force-full") result.forceFull = true;
    else throw new Error(`Unsupported argument: ${argument}`);
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let options;
  let result;
  try {
    options = parseArguments(process.argv.slice(2));
    result = options.forceFull
      ? full("manual or untrusted-context full validation override")
      : classifyReleaseRange(options);
  } catch (error) {
    result = full(`classifier exception: ${error instanceof Error ? error.message : "unknown"}`);
  }
  if (options?.githubOutput) writeGithubOutput(options.githubOutput, result, options.baseSha);
  process.stdout.write(
    `${JSON.stringify(
      {
        scope: result.scope,
        reason: result.reason,
        changedFiles: result.changedFiles.length,
        affectedWorkspaces: result.affectedWorkspaces,
        imageTargets: result.imageTargets,
      },
      null,
      2,
    )}\n`,
  );
}
