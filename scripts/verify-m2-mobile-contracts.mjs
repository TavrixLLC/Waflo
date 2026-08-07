import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const directory = resolve(
  process.env.M2_OUTPUT_DIRECTORY ?? "artifacts/handoff-w4-m2-provenance-repair/mobile-contracts",
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const manifest = JSON.parse(await readFile(resolve(directory, "source-manifest.json"), "utf8"));
const expectedCommit = process.env.M2_EXPECTED_BACKEND_COMMIT ?? git("rev-parse", "HEAD");
if (manifest.backendCommitSha !== expectedCommit) {
  throw new Error(
    `Manifest backendCommitSha ${manifest.backendCommitSha} does not match ${expectedCommit}.`,
  );
}

for (const [path, expectedHash] of Object.entries(manifest.sourceFiles)) {
  const content = execFileSync("git", ["show", `${manifest.backendCommitSha}:${path}`]);
  if (sha256(content) !== expectedHash) throw new Error(`Source hash mismatch: ${path}`);
}
for (const [name, expectedHash] of Object.entries(manifest.generatedFiles)) {
  const content = await readFile(resolve(directory, name));
  if (sha256(content) !== expectedHash) throw new Error(`Generated hash mismatch: ${name}`);
}
const bundleSha256 = sha256(
  Object.entries(manifest.generatedFiles)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, hash]) => `${name}:${hash}`)
    .join("\n"),
);
if (bundleSha256 !== manifest.bundleSha256) throw new Error("Bundle checksum mismatch.");

const m2Schema = JSON.parse(await readFile(resolve(directory, "m2.schema.json"), "utf8"));
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
  const content = await readFile(resolve(directory, name), "utf8");
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
