import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const verifier = resolve(repositoryRoot, "scripts/verify-m2-mobile-contracts.mjs");
const durableBundle = resolve(repositoryRoot, "docs/contracts/m2");
const historicalBaseline = "0cc39d9ecb39a34fdbd91498e55b6d6ac35c281e";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runVerifier({ directory = durableBundle, cwd = repositoryRoot, expectedCommit } = {}) {
  const env = { ...process.env, M2_OUTPUT_DIRECTORY: directory };
  if (expectedCommit === undefined) delete env.M2_EXPECTED_BACKEND_COMMIT;
  else env.M2_EXPECTED_BACKEND_COMMIT = expectedCommit;

  return spawnSync(process.execPath, [verifier], { cwd, env, encoding: "utf8" });
}

async function temporaryBundle(t) {
  const directory = await mkdtemp(join(tmpdir(), "waflo-m2-verifier-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(durableBundle, directory, { recursive: true });
  return directory;
}

test("the retained M2 baseline and durable bundle verify", () => {
  const result = runVerifier({ expectedCommit: historicalBaseline });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).verified, true);
});

test("a durable M2 contract mutation fails verification", async (t) => {
  const directory = await temporaryBundle(t);
  await appendFile(join(directory, "m2.schema.json"), "\n");

  const result = runVerifier({ directory, expectedCommit: historicalBaseline });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Generated hash mismatch: m2\.schema\.json/u);
});

test("a missing durable M2 contract file fails verification", async (t) => {
  const directory = await temporaryBundle(t);
  await rm(join(directory, "stamp-success.fixture.json"));

  const result = runVerifier({ directory, expectedCommit: historicalBaseline });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Required durable M2 contract file is missing: stamp-success\.fixture\.json/u,
  );
});

test("a wrong expected historical backend baseline fails verification", () => {
  const result = runVerifier({ expectedCommit: "0000000000000000000000000000000000000000" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Manifest backendCommitSha .* does not match/u);
});

test("a required historical source path missing from the baseline fails clearly", async (t) => {
  const { directory, commit } = await provenanceFixture(t, "missing-contract-source.txt");
  const manifestPath = join(directory, "source-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.sourceFiles = { "missing-contract-source.txt": sha256("missing") };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = runVerifier({ directory, cwd: dirname(directory), expectedCommit: commit });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    new RegExp(
      `Required historical M2 source file is missing: missing-contract-source\\.txt at ${commit}`,
      "u",
    ),
  );
});

test("an unrelated root package.json is not required when provenance does not record it", async (t) => {
  const { directory, commit } = await provenanceFixture(t, "contract-source.txt", "contract-v1\n");

  const result = runVerifier({ directory, cwd: dirname(directory), expectedCommit: commit });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).sourceFileCount, 1);
});

async function provenanceFixture(t, sourcePath, sourceContent = "contract-v1\n") {
  const repository = await mkdtemp(join(tmpdir(), "waflo-m2-history-"));
  t.after(() => rm(repository, { recursive: true, force: true }));

  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repository });
  execFileSync("git", ["config", "user.name", "M2 verifier test"], { cwd: repository });
  execFileSync("git", ["config", "user.email", "m2-verifier@example.invalid"], {
    cwd: repository,
  });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: repository });
  await writeFile(join(repository, "contract-source.txt"), sourceContent);
  execFileSync("git", ["add", "contract-source.txt"], { cwd: repository });
  execFileSync("git", ["commit", "--quiet", "-m", "historical contract source"], {
    cwd: repository,
  });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  }).trim();

  const directory = join(repository, "durable-m2");
  await mkdir(directory);
  await cp(durableBundle, directory, { recursive: true });
  const manifestPath = join(directory, "source-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.backendCommitSha = commit;
  manifest.sourceFiles = { [sourcePath]: sha256(sourceContent) };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { directory, commit };
}
