import { execFile } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import {
  ApplePassBuilderGenerator,
  AppleWalletProvider,
  adoptedApplePassBuilderRevision,
} from "../packages/wallet-apple/dist/index.js";

const execute = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const image = process.env.APPLE_PASS_BUILDER_SMOKE_IMAGE ?? "waflo/apple-pass-builder:8908b955";
const temporaryDirectory = await mkdtemp(join(tmpdir(), "waflo-pass-builder-smoke-"));
const containerName = `waflo-pass-builder-smoke-${randomUUID()}`;
const hostPort = randomInt(20_000, 30_000);
const password = "waflo-smoke-certificate-password";
const authToken = `waflo-smoke-${"x".repeat(32)}`;
const hostUid = typeof process.getuid === "function" ? process.getuid() : undefined;

async function docker(arguments_, options = {}) {
  return execute("docker", arguments_, {
    cwd: repositoryRoot,
    timeout: options.timeout ?? 120_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
}

function testMembership() {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    organizationName: "Cedar Coffee",
    programId: "00000000-0000-4000-8000-000000000002",
    programVersionId: "00000000-0000-4000-8000-000000000003",
    programName: "بطاقة الوفاء / Cedar Circle",
    description: "A bilingual loyalty membership.",
    rewardSummary: "مشروب مجاني / Complimentary drink",
    backgroundColor: "#F7F4EE",
    foregroundColor: "#241916",
    configurationFingerprint: "a".repeat(64),
    locale: "ar",
    walletPassInstanceId: "00000000-0000-4000-8000-000000000004",
    providerIdentity: "waflo.00000000000040008000000000000004",
    publicMembershipId: "member_m8PNYl1aSr9bT0V4w89d3H2g",
    displayName: "سارة / Sara",
    credentialPayload: "wfl1.exact.smoke.credential",
    currentStampCount: 5,
    requiredStampCount: 8,
    rewardReady: false,
    membershipStatus: "ACTIVE",
    programStatus: "PUBLISHED",
    transferred: false,
    stampRenderInput: {
      organizationId: "00000000-0000-4000-8000-000000000001",
      programId: "00000000-0000-4000-8000-000000000002",
      programVersionId: "00000000-0000-4000-8000-000000000003",
      membershipId: "00000000-0000-4000-8000-000000000005",
      rendererSchemaVersion: "waflo-stamp-render-v1",
      locale: "ar",
      requiredStampCount: 8,
      currentStampCount: 5,
      rewardReady: false,
      layoutType: "GRID",
      layoutConfiguration: { columns: 4 },
      visualTheme: {
        filledColor: "#E4572E",
        emptyColor: "#F3A712",
        accentColor: "#E4572E",
        backgroundColor: "#F7F4EE",
        foregroundColor: "#241916",
        stampSize: 48,
        spacing: 8,
      },
      filledArtwork: {
        kind: "svg",
        trusted: true,
        content:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="#E4572E"/></svg>',
      },
      emptyArtwork: {
        kind: "svg",
        trusted: true,
        content:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="#F7F4EE" stroke="#241916" stroke-width="7"/></svg>',
      },
      assetDigests: { filled: "b".repeat(64), empty: "c".repeat(64) },
      outputProfile: "APPLE_WALLET",
    },
  };
}

async function openssl(arguments_) {
  await docker([
    "run",
    "--rm",
    "--user",
    "0:0",
    "--mount",
    `type=bind,src=${temporaryDirectory},dst=/work`,
    "--entrypoint",
    "/usr/bin/openssl",
    image,
    ...arguments_,
  ]);
}

async function createCertificates() {
  await openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-keyout",
    "/work/wwdr.key",
    "-out",
    "/work/wwdr.pem",
    "-days",
    "1",
    "-subj",
    "/CN=Waflo Smoke WWDR",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  await openssl([
    "req",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-keyout",
    "/work/pass.key",
    "-out",
    "/work/pass.csr",
    "-subj",
    "/UID=pass.app.waflo/OU=WAFLOTEAM/CN=Pass Type ID: pass.app.waflo",
  ]);
  for (const fixture of [
    { certificate: "pass.pem", days: "1", p12: "pass.p12" },
    { certificate: "expired.pem", days: "0", p12: "expired.p12" },
  ]) {
    await openssl([
      "x509",
      "-req",
      "-in",
      "/work/pass.csr",
      "-CA",
      "/work/wwdr.pem",
      "-CAkey",
      "/work/wwdr.key",
      "-CAcreateserial",
      "-out",
      `/work/${fixture.certificate}`,
      "-days",
      fixture.days,
      "-sha256",
    ]);
    await openssl([
      "pkcs12",
      "-export",
      "-legacy",
      "-out",
      `/work/${fixture.p12}`,
      "-inkey",
      "/work/pass.key",
      "-in",
      `/work/${fixture.certificate}`,
      "-name",
      "Waflo smoke identity",
      "-passout",
      `pass:${password}`,
    ]);
  }
}

async function waitForService(serviceUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${serviceUrl}/health`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error("Pass Builder smoke service did not become ready.");
}

async function rejected(operation) {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

async function containerResourceUsage() {
  const script = [
    "const fs=require('node:fs');",
    "const read=(path)=>Number(fs.readFileSync(path,'utf8').trim());",
    "const cpu=fs.readFileSync('/sys/fs/cgroup/cpu.stat','utf8');",
    "const usage=Number(/^usage_usec (\\d+)$/m.exec(cpu)?.[1]??0);",
    "process.stdout.write(JSON.stringify({memoryCurrentBytes:read('/sys/fs/cgroup/memory.current'),memoryPeakBytes:read('/sys/fs/cgroup/memory.peak'),cpuUsageMicroseconds:usage}));",
  ].join("");
  return JSON.parse((await docker(["exec", containerName, "node", "-e", script])).stdout);
}

try {
  await createCertificates();
  await writeFile(join(temporaryDirectory, "auth-token"), authToken, { mode: 0o600 });
  await writeFile(join(temporaryDirectory, "certificate-password"), password, { mode: 0o600 });
  await writeFile(
    join(temporaryDirectory, "identities.json"),
    JSON.stringify({
      identities: [
        {
          id: "waflo-default",
          merchantIds: ["00000000-0000-4000-8000-000000000001"],
          passTypeIdentifier: "pass.app.waflo",
          teamIdentifier: "WAFLOTEAM",
          certificatePath: "/run/test/pass.p12",
          certificatePasswordFile: "/run/test/certificate-password",
          wwdrCertificatePath: "/run/test/wwdr.pem",
        },
      ],
    }),
    { mode: 0o600 },
  );
  await docker([
    "run",
    "--rm",
    "--user",
    "0:0",
    "--mount",
    `type=bind,src=${temporaryDirectory},dst=/work`,
    "--entrypoint",
    "/usr/bin/chmod",
    image,
    "0440",
    "/work/auth-token",
    "/work/identities.json",
    "/work/expired.p12",
    "/work/wwdr.pem",
  ]);
  // The failure cases deliberately replace these two host-side fixtures while
  // the running container sees the entire bind mount as read-only.
  await docker([
    "run",
    "--rm",
    "--user",
    "0:0",
    "--mount",
    `type=bind,src=${temporaryDirectory},dst=/work`,
    "--entrypoint",
    "/usr/bin/chmod",
    image,
    "0640",
    "/work/certificate-password",
    "/work/pass.p12",
  ]);
  // On POSIX CI runners the bind source is initially owned by the runner and
  // its temporary directory is not traversable by the non-root service. Keep
  // the runner as owner for the deliberate mutation cases below, but expose
  // the fixture through the service's restricted group exactly as staging
  // provider-secret files are mounted. Docker Desktop's Windows bind mounts
  // do not provide POSIX ownership semantics, so preserve their native path.
  if (hostUid !== undefined) {
    await docker([
      "run",
      "--rm",
      "--user",
      "0:0",
      "--mount",
      `type=bind,src=${temporaryDirectory},dst=/work`,
      "--entrypoint",
      "/usr/bin/chown",
      image,
      `${hostUid}:10001`,
      "/work",
      "/work/auth-token",
      "/work/identities.json",
      "/work/certificate-password",
      "/work/pass.p12",
      "/work/expired.p12",
      "/work/wwdr.pem",
    ]);
    await docker([
      "run",
      "--rm",
      "--user",
      "0:0",
      "--mount",
      `type=bind,src=${temporaryDirectory},dst=/work`,
      "--entrypoint",
      "/usr/bin/chmod",
      image,
      "0750",
      "/work",
    ]);
  }
  await docker([
    "run",
    "--detach",
    "--name",
    containerName,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=256m,mode=0700,uid=10001,gid=10001",
    "--publish",
    `127.0.0.1:${hostPort}:8080`,
    "--mount",
    `type=bind,src=${temporaryDirectory},dst=/run/test,readonly`,
    "--env",
    "PASS_BUILDER_AUTH_TOKEN_FILE=/run/test/auth-token",
    "--env",
    "PASS_BUILDER_IDENTITIES_CONFIG_FILE=/run/test/identities.json",
    "--env",
    "NODE_ENV=development",
    "--env",
    "PASS_BUILDER_DIAGNOSTIC_ERRORS=true",
    image,
  ]);

  const serviceUrl = `http://127.0.0.1:${hostPort}`;
  const health = await waitForService(serviceUrl);
  const generator = new ApplePassBuilderGenerator({
    serviceUrl,
    authToken,
    signingKeyId: "waflo-default",
    timeoutMs: 30_000,
  });
  const input = {
    membership: testMembership(),
    configuration: {
      passTypeIdentifier: "pass.app.waflo",
      teamIdentifier: "WAFLOTEAM",
      organizationName: "Waflo smoke test",
      webServiceUrl: "https://api.example.test/v1/apple-wallet",
    },
    authenticationToken: "a".repeat(43),
  };
  const provider = new AppleWalletProvider({
    mode: "REAL",
    configuration: input.configuration,
    generator,
    authenticationToken: () => input.authenticationToken,
    passDownloadUrl: "https://api.example.test/v1/customer/wallet/apple/pass",
  });

  const startCold = performance.now();
  const validation = await generator.validatePass(input);
  const coldValidationMs = performance.now() - startCold;
  const startWarm = performance.now();
  await generator.validatePass(input);
  const warmValidationMs = performance.now() - startWarm;
  const startSigning = performance.now();
  const issued = await provider.issueMembershipPass(input.membership);
  const artifact = issued.artifact;
  const signedGenerationMs = performance.now() - startSigning;
  const artifactPath = join(temporaryDirectory, "smoke.pkpass");
  await writeFile(artifactPath, artifact, { mode: 0o600 });

  const entries = unzipSync(artifact);
  const pass = JSON.parse(Buffer.from(entries["pass.json"]).toString("utf8"));
  const manifest = JSON.parse(Buffer.from(entries["manifest.json"]).toString("utf8"));
  const manifestValid = Object.entries(manifest).every(([name, digest]) => {
    const bytes = entries[name];
    return bytes && createHash("sha1").update(bytes).digest("hex") === digest;
  });
  const extractedDirectory = join(temporaryDirectory, "extracted");
  await mkdir(extractedDirectory, { mode: 0o700 });
  await writeFile(join(extractedDirectory, "manifest.json"), entries["manifest.json"], {
    mode: 0o600,
  });
  await writeFile(join(extractedDirectory, "signature"), entries.signature, { mode: 0o600 });
  await openssl([
    "cms",
    "-verify",
    "-binary",
    "-inform",
    "DER",
    "-in",
    "/work/extracted/signature",
    "-content",
    "/work/extracted/manifest.json",
    "-CAfile",
    "/work/wwdr.pem",
    "-purpose",
    "any",
    "-out",
    "/dev/null",
  ]);

  await writeFile(join(temporaryDirectory, "certificate-password"), "incorrect-password", {
    mode: 0o600,
  });
  const incorrectPasswordRejected = await rejected(() => generator.generatePass(input));
  await writeFile(join(temporaryDirectory, "certificate-password"), password, { mode: 0o600 });
  const validP12 = await readFile(join(temporaryDirectory, "pass.p12"));
  const expiredP12 = await readFile(join(temporaryDirectory, "expired.p12"));
  await writeFile(join(temporaryDirectory, "pass.p12"), expiredP12, { mode: 0o600 });
  const expiredCertificateRejected = await rejected(() => generator.generatePass(input));
  await writeFile(join(temporaryDirectory, "pass.p12"), "not a PKCS12 certificate", {
    mode: 0o600,
  });
  const invalidCertificateRejected = await rejected(() => generator.generatePass(input));
  await writeFile(join(temporaryDirectory, "pass.p12"), validP12, { mode: 0o600 });

  const resourceUsageBefore = await containerResourceUsage();
  const concurrentStart = performance.now();
  await Promise.all(Array.from({ length: 4 }, () => generator.validatePass(input)));
  const fourConcurrentValidationsMs = performance.now() - concurrentStart;
  const resourceUsageAfter = await containerResourceUsage();
  const metricsResponse = await fetch(`${serviceUrl}/metrics`, {
    headers: { authorization: `Bearer ${authToken}` },
  });
  if (!metricsResponse.ok) throw new Error("Metrics endpoint did not respond successfully.");
  const metrics = await metricsResponse.text();
  const requiredMetricNames = [
    "wallet_pass_generation_total",
    "wallet_pass_generation_failed_total",
    "wallet_pass_generation_duration_seconds",
    "wallet_pass_validation_failed_total",
    "wallet_pass_signing_failed_total",
  ];
  const serviceGenerationSeconds = Number(
    /^wallet_pass_generation_duration_seconds_sum ([0-9.]+)$/m.exec(metrics)?.[1] ?? Number.NaN,
  );
  const imageInspection = JSON.parse(
    (await docker(["image", "inspect", "--format", "{{json .Size}}", image])).stdout.trim(),
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        passBuilderRevision: adoptedApplePassBuilderRevision,
        health,
        validation,
        pass: {
          passTypeIdentifier: pass.passTypeIdentifier,
          serialNumber: pass.serialNumber,
          hasGenericFallback: Boolean(pass.generic),
          hasPosterGeneric: Boolean(pass.posterGeneric),
          barcodeMessagePreserved:
            pass.barcodes?.[0]?.message === input.membership.credentialPayload,
          arabicPreserved: JSON.stringify(pass).includes("سارة"),
        },
        artifact: {
          bytes: artifact.length,
          sha256: createHash("sha256").update(artifact).digest("hex"),
          manifestValid,
          cmsSignatureAndChainValid: true,
          testChainOnly: true,
          providerReportedGenerator: issued.safeMetadata?.generator,
        },
        failures: {
          incorrectPasswordRejected,
          expiredCertificateRejected,
          invalidCertificateRejected,
        },
        timingMs: {
          coldValidation: Number(coldValidationMs.toFixed(1)),
          warmValidation: Number(warmValidationMs.toFixed(1)),
          signedGeneration: Number(signedGenerationMs.toFixed(1)),
          serviceSignedGeneration: Number((serviceGenerationSeconds * 1_000).toFixed(1)),
          clientPersonalizationAndTransport:
            Number.isFinite(serviceGenerationSeconds) &&
            signedGenerationMs > serviceGenerationSeconds * 1_000
              ? Number((signedGenerationMs - serviceGenerationSeconds * 1_000).toFixed(1))
              : null,
          fourConcurrentValidations: Number(fourConcurrentValidationsMs.toFixed(1)),
        },
        resources: {
          memoryCurrentBytes: resourceUsageAfter.memoryCurrentBytes,
          memoryPeakBytes: resourceUsageAfter.memoryPeakBytes,
          fourConcurrentCpuUsageMicroseconds:
            resourceUsageAfter.cpuUsageMicroseconds - resourceUsageBefore.cpuUsageMicroseconds,
        },
        requiredMetricsPresent: requiredMetricNames.every((name) => metrics.includes(name)),
        imageBytes: imageInspection,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  try {
    const logs = await docker(["logs", containerName]);
    process.stderr.write(logs.stdout);
    process.stderr.write(logs.stderr);
  } catch {}
  throw error;
} finally {
  await docker(["rm", "--force", containerName]).catch(() => undefined);
  if (process.env.APPLE_PASS_BUILDER_SMOKE_KEEP_TEMP === "1") {
    process.stderr.write(`Smoke fixtures retained at ${temporaryDirectory}\n`);
  } else {
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 2 });
  }
}
