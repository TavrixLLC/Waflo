import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const archiveArgument = process.argv.slice(2).find((argument) => argument !== "--");
const archive = resolve(
  archiveArgument ?? "artifacts/handoff-w4-round-1/waflo-w4-round-1-portable-source.zip",
);
const logPath = resolve("artifacts/handoff-w4-round-1/raw-test-output/archive-extraction.log");
const temporary = await mkdtemp(resolve(tmpdir(), "waflo-w4-archive-verification-"));
const output = [];

function record(line) {
  output.push(line);
  process.stdout.write(`${line}\n`);
}

async function run(label, command, arguments_, cwd = root) {
  record(`\n## ${label}`);
  record(`cwd=${cwd}`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output.push(text.trimEnd());
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output.push(text.trimEnd());
      process.stderr.write(text);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      record(`exit_code=${code ?? "none"}`);
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} exited with ${code ?? "no status"}.`));
    });
  });
}

function pnpmInvocation(arguments_) {
  const npmExecPath = Reflect.get(process.env, "npm_execpath");
  if (npmExecPath) return [process.execPath, [npmExecPath, ...arguments_]];
  if (process.platform === "win32") {
    return ["cmd.exe", ["/d", "/s", "/c", "pnpm", ...arguments_]];
  }
  return ["pnpm", arguments_];
}

let failure;
try {
  record(`checked_at=${new Date().toISOString()}`);
  record(`archive=${archive}`);
  await run("archive inspection", process.execPath, [
    resolve("scripts/inspect-portable-archive.mjs"),
    archive,
  ]);
  await run("archive extraction", "tar", ["-xf", archive, "-C", temporary]);
  await access(resolve(temporary, "package.json"));
  await access(resolve(temporary, "pnpm-lock.yaml"));
  record("required_root_files=PASS");
  const [installCommand, installArguments] = pnpmInvocation(["install", "--frozen-lockfile"]);
  await run("frozen install from extracted archive", installCommand, installArguments, temporary);
  const [formatCommand, formatArguments] = pnpmInvocation(["format:check"]);
  await run("format check from extracted archive", formatCommand, formatArguments, temporary);
  const [lintCommand, lintArguments] = pnpmInvocation(["lint"]);
  await run("lint from extracted archive", lintCommand, lintArguments, temporary);
  record("archive_verification=PASS");
} catch (error) {
  failure = error;
  record(`archive_verification=FAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
  record(`temporary_extraction_removed=${temporary}`);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, `${output.join("\n")}\n`, "utf8");
}

if (failure) throw failure;
