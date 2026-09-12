import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PassBuilderServiceConfiguration } from "./config.js";
import type { SigningIdentity } from "./contracts.js";
import { runExecutable } from "./subprocess.js";

function subjectAttribute(subject: string, attribute: "UID" | "OU"): string | undefined {
  return new RegExp(`(?:^|,)${attribute}=([^,]+)`).exec(subject)?.[1]?.replaceAll("\\\\,", ",");
}

/**
 * The buildpass CLI signs with the supplied P12 but, unlike the Swift API's
 * PassCertificate.validateAttributes(), does not assert its UID/OU. Keep this
 * small preflight at the adapter boundary so a configuration error cannot sign
 * one merchant's pass with another signing identity.
 */
export async function validateSigningCertificate(input: {
  readonly identity: SigningIdentity;
  readonly password: string;
  readonly opensslPath: string;
  readonly workDirectory: string;
  readonly timeoutMs: number;
}): Promise<{
  readonly expiresAt: string;
  readonly wwdrCertificatePath: string;
}> {
  const passCertificatePem = join(input.workDirectory, "pass-certificate.pem");
  const wwdrCertificatePem = join(input.workDirectory, "wwdr-certificate.pem");
  const wwdrCertificateDer = join(input.workDirectory, "wwdr-certificate.cer");
  const passwordEnvironment = { BUILDPASS_PASS_CERTIFICATE_PASSWORD: input.password };

  try {
    await runExecutable({
      executable: input.opensslPath,
      arguments: [
        "pkcs12",
        "-legacy",
        "-in",
        input.identity.certificatePath,
        "-clcerts",
        "-nokeys",
        "-passin",
        "env:BUILDPASS_PASS_CERTIFICATE_PASSWORD",
        "-out",
        passCertificatePem,
      ],
      environment: passwordEnvironment,
      timeoutMs: input.timeoutMs,
    });

    const wwdrBytes = await readFile(input.identity.wwdrCertificatePath);
    const wwdrIsPem = wwdrBytes.subarray(0, 27).toString("ascii").includes("-----BEGIN");
    await runExecutable({
      executable: input.opensslPath,
      arguments: [
        "x509",
        ...(wwdrIsPem ? [] : ["-inform", "DER"]),
        "-in",
        input.identity.wwdrCertificatePath,
        "-out",
        wwdrCertificatePem,
      ],
      timeoutMs: input.timeoutMs,
    });

    // Pass Builder's PassCertificate accepts PKCS#12 or a DER X.509
    // certificate. The existing Waflo deployment accepts a PEM WWDR secret,
    // so normalize it inside the operation-local directory before invoking
    // buildpass rather than changing the platform's certificate contract.
    if (wwdrIsPem) {
      await runExecutable({
        executable: input.opensslPath,
        arguments: [
          "x509",
          "-in",
          input.identity.wwdrCertificatePath,
          "-outform",
          "DER",
          "-out",
          wwdrCertificateDer,
        ],
        timeoutMs: input.timeoutMs,
      });
    }

    const attributes = await runExecutable({
      executable: input.opensslPath,
      arguments: [
        "x509",
        "-in",
        passCertificatePem,
        "-noout",
        "-subject",
        "-dates",
        "-nameopt",
        "RFC2253",
      ],
      timeoutMs: input.timeoutMs,
    });
    const subject = attributes.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("subject="))
      ?.slice("subject=".length);
    if (
      !subject ||
      subjectAttribute(subject, "UID") !== input.identity.passTypeIdentifier ||
      subjectAttribute(subject, "OU") !== input.identity.teamIdentifier
    ) {
      throw new Error("PASS_SIGNING_IDENTITY_MISMATCH");
    }
    const notAfter = attributes.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("notAfter="))
      ?.slice("notAfter=".length);
    const expiration = notAfter ? new Date(notAfter) : new Date(Number.NaN);
    if (!Number.isFinite(expiration.getTime())) throw new Error("PASS_CERTIFICATE_INVALID");

    await runExecutable({
      executable: input.opensslPath,
      arguments: [
        "verify",
        "-partial_chain",
        "-purpose",
        "any",
        "-CAfile",
        wwdrCertificatePem,
        passCertificatePem,
      ],
      timeoutMs: input.timeoutMs,
    });
    return {
      expiresAt: expiration.toISOString(),
      wwdrCertificatePath: wwdrIsPem ? wwdrCertificateDer : input.identity.wwdrCertificatePath,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "PASS_SIGNING_IDENTITY_MISMATCH") throw error;
    throw new Error("PASS_CERTIFICATE_INVALID", { cause: error });
  }
}

export async function preflightSigningIdentities(
  configuration: PassBuilderServiceConfiguration,
): Promise<ReadonlyMap<string, string>> {
  const results = new Map<string, string>();
  for (const identity of configuration.identities.values()) {
    const prefix = join(configuration.tempRoot ?? tmpdir(), "waflo-cert-preflight-");
    const workDirectory = await mkdtemp(prefix);
    try {
      const password = (await readFile(identity.certificatePasswordFile, "utf8")).trim();
      if (password.length === 0 || password.length > 1_024) {
        throw new Error("PASS_CERTIFICATE_PASSWORD_INVALID");
      }
      const certificate = await validateSigningCertificate({
        identity,
        password,
        opensslPath: configuration.opensslPath,
        workDirectory,
        timeoutMs: configuration.processTimeoutMs,
      });
      results.set(identity.id, certificate.expiresAt);
    } finally {
      await rm(workDirectory, { recursive: true, force: true, maxRetries: 2 });
    }
  }
  return results;
}
