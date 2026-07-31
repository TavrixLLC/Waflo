import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";

const root = process.cwd();
const outputArgument = process.argv.slice(2).find((argument) => argument !== "--");
const output = resolve(outputArgument ?? "artifacts/waflo-portable-source.zip");
const forbiddenDirectories = new Set([
  ".git",
  ".next",
  ".pnpm-store",
  ".turbo",
  "artifacts",
  "coverage",
  "dist",
  "docker-volumes",
  "minio-data",
  "node_modules",
  "playwright-report",
  "postgres-data",
  "redis-data",
  "test-results",
  "tmp",
]);
const forbiddenFileNames = new Set([".env", ".DS_Store"]);
const forbiddenExtensions = new Set([
  ".cer",
  ".crt",
  ".der",
  ".jks",
  ".key",
  ".keystore",
  ".p12",
  ".pem",
  ".pfx",
]);

function includedFile(name) {
  if (forbiddenFileNames.has(name)) return false;
  if (name.startsWith(".env.") && name !== ".env.example") return false;
  const extension = name.slice(name.lastIndexOf(".")).toLocaleLowerCase();
  if (forbiddenExtensions.has(extension)) return false;
  if (/service[-_.]?account.*\.json$/iu.test(name)) return false;
  if (name.endsWith(".log") || name.endsWith(".tmp")) return false;
  if (name.endsWith(".tsbuildinfo")) return false;
  return true;
}

async function collect(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && forbiddenDirectories.has(entry.name)) continue;
    if (!entry.isDirectory() && !includedFile(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    if (absolute === output) continue;
    if (entry.isDirectory()) {
      await collect(absolute, files);
    } else if (entry.isFile()) {
      files.push(relative(root, absolute).split(sep).join("/"));
    }
  }
}

function run(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code ?? "no status"}.`));
    });
  });
}

const files = [];
await collect(root, files);
files.sort();
if (!files.length) throw new Error("No portable source files were selected.");
await mkdir(dirname(output), { recursive: true });
const temporary = await mkdtemp(resolve(tmpdir(), "waflo-archive-"));
const listPath = resolve(temporary, "files.txt");
try {
  await writeFile(listPath, `${files.join("\n")}\n`, "utf8");
  await run("tar", ["-a", "-cf", output, "-C", root, "-T", listPath]);
  const archiveHash = createHash("sha256")
    .update(await readFile(output))
    .digest("hex");
  const checksumPath = `${output}.sha256`;
  await writeFile(checksumPath, `${archiveHash}  ${basename(output)}\n`, "utf8");
  process.stdout.write(
    `Created ${output}\nIncluded ${files.length} source files.\nSHA-256: ${archiveHash}\nChecksum: ${checksumPath}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
