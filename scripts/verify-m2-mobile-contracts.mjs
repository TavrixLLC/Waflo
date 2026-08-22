import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(process.env.M2_OUTPUT_DIRECTORY ?? "docs/contracts/m2");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readDurableFile(name, encoding) {
  try {
    return await readFile(resolve(directory, name), encoding);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Required durable M2 contract file is missing: ${name}`);
    }
    throw error;
  }
}

function gitObjectExists(specification) {
  const result = spawnSync("git", ["cat-file", "-e", specification], { stdio: "ignore" });
  if (result.error)
    throw new Error(`Unable to inspect historical M2 Git objects: ${result.error.message}`);
  return result.status === 0;
}

function readHistoricalFile(commit, path) {
  const specification = `${commit}:${path}`;
  if (!gitObjectExists(specification)) {
    throw new Error(`Required historical M2 source file is missing: ${path} at ${commit}`);
  }
  return execFileSync("git", ["cat-file", "blob", specification], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const manifest = JSON.parse(await readDurableFile("source-manifest.json", "utf8"));
const expectedCommit = process.env.M2_EXPECTED_BACKEND_COMMIT ?? manifest.backendCommitSha;
if (manifest.backendCommitSha !== expectedCommit) {
  throw new Error(
    `Manifest backendCommitSha ${manifest.backendCommitSha} does not match ${expectedCommit}.`,
  );
}

if (!gitObjectExists(`${manifest.backendCommitSha}^{commit}`)) {
  throw new Error(
    `Historical M2 backend commit ${manifest.backendCommitSha} is unavailable. Fetch complete Git history before verification.`,
  );
}
if (!gitObjectExists(`${manifest.backendCommitSha}^{tree}`)) {
  throw new Error(
    `Historical M2 backend tree ${manifest.backendCommitSha} is unavailable or incomplete. Fetch complete Git history before verification.`,
  );
}

for (const [path, expectedHash] of Object.entries(manifest.sourceFiles)) {
  const content = readHistoricalFile(manifest.backendCommitSha, path);
  if (sha256(content) !== expectedHash) throw new Error(`Source hash mismatch: ${path}`);
}
for (const [name, expectedHash] of Object.entries(manifest.generatedFiles)) {
  const content = await readDurableFile(name);
  if (sha256(content) !== expectedHash) throw new Error(`Generated hash mismatch: ${name}`);
}
const bundleSha256 = sha256(
  Object.entries(manifest.generatedFiles)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, hash]) => `${name}:${hash}`)
    .join("\n"),
);
if (bundleSha256 !== manifest.bundleSha256) throw new Error("Bundle checksum mismatch.");

const m2Schema = JSON.parse(await readDurableFile("m2.schema.json", "utf8"));
const currency = m2Schema.$defs?.PurchaseCurrency;
if (
  currency?.type !== "string" ||
  currency?.pattern !== "^[A-Za-z]{3}$" ||
  currency?.minLength !== 3 ||
  currency?.maxLength !== 3
) {
  throw new Error("Generated purchaseCurrency schema does not match runtime validation.");
}

const forbidden = [
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/u,
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /"(?:accessToken|refreshToken|qrPayload|privateKey|signingSecret|customerEmail|phone)"\s*:\s*"[^"]+"/iu,
  /wfl1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u,
];
for (const name of [...Object.keys(manifest.generatedFiles), "source-manifest.json"]) {
  const content = await readDurableFile(name, "utf8");
  if (forbidden.some((pattern) => pattern.test(content))) {
    throw new Error(`Secret or credential pattern detected in ${name}.`);
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      verified: true,
      backendCommitSha: manifest.backendCommitSha,
      sourceFileCount: Object.keys(manifest.sourceFiles).length,
      generatedFileCount: Object.keys(manifest.generatedFiles).length,
      bundleSha256,
      secretPatternsDetected: 0,
    },
    null,
    2,
  )}\n`,
);
