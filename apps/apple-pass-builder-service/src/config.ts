import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSigningIdentities, type SigningIdentity } from "./contracts.js";

export const applePassBuilderRevision = "8908b955a42da8294ce7506719aa1f186d096c02";

export interface PassBuilderServiceConfiguration {
  readonly host: string;
  readonly port: number;
  readonly authToken: Buffer;
  readonly buildpassPath: string;
  readonly opensslPath: string;
  readonly protobufRoot: string;
  readonly templateRoot: string;
  readonly tempRoot?: string;
  readonly identities: ReadonlyMap<string, SigningIdentity>;
  readonly maxBodyBytes: number;
  readonly maxConcurrentBuilds: number;
  readonly processTimeoutMs: number;
  readonly diagnosticErrors: boolean;
}

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Expected an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function loadServiceConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PassBuilderServiceConfiguration> {
  const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const tokenPath = required(
    environment.PASS_BUILDER_AUTH_TOKEN_FILE,
    "PASS_BUILDER_AUTH_TOKEN_FILE",
  );
  const identitiesPath = required(
    environment.PASS_BUILDER_IDENTITIES_CONFIG_FILE,
    "PASS_BUILDER_IDENTITIES_CONFIG_FILE",
  );
  const [tokenFile, identitiesFile] = await Promise.all([
    readFile(tokenPath),
    readFile(identitiesPath, "utf8"),
  ]);
  const authTokenText = tokenFile.toString("utf8").trim();
  const authToken = Buffer.from(authTokenText, "utf8");
  if (!/^[A-Za-z0-9._~-]{32,256}$/.test(authTokenText)) {
    throw new Error("The Pass Builder service auth token must contain 32 to 256 bytes.");
  }
  const identities = parseSigningIdentities(JSON.parse(identitiesFile));
  const diagnosticErrors = environment.PASS_BUILDER_DIAGNOSTIC_ERRORS === "true";
  if (diagnosticErrors && environment.NODE_ENV === "production") {
    throw new Error("PASS_BUILDER_DIAGNOSTIC_ERRORS cannot be enabled in production.");
  }
  const buildpassPath = environment.PASS_BUILDER_EXECUTABLE ?? "/opt/pass-builder/buildpass";
  const opensslPath = environment.PASS_BUILDER_OPENSSL_EXECUTABLE ?? "/usr/bin/openssl";
  const protobufRoot = environment.PASS_BUILDER_PROTOBUF_ROOT ?? "/opt/pass-builder/Protobufs";
  const templateRoot = environment.PASS_BUILDER_TEMPLATE_ROOT ?? resolve(serviceRoot, "templates");
  await Promise.all([
    access(buildpassPath, constants.R_OK | constants.X_OK),
    access(opensslPath, constants.R_OK | constants.X_OK),
    access(resolve(protobufRoot, "PassPackage.proto"), constants.R_OK),
    access(templateRoot, constants.R_OK),
    ...[...identities.values()].flatMap((identity) => [
      access(identity.certificatePath, constants.R_OK),
      access(identity.certificatePasswordFile, constants.R_OK),
      access(identity.wwdrCertificatePath, constants.R_OK),
    ]),
  ]);
  return {
    host: environment.PASS_BUILDER_HOST ?? "0.0.0.0",
    port: integer(environment.PASS_BUILDER_PORT, 8080, 1, 65_535),
    authToken,
    buildpassPath,
    opensslPath,
    protobufRoot,
    templateRoot,
    ...(environment.PASS_BUILDER_TEMP_ROOT ? { tempRoot: environment.PASS_BUILDER_TEMP_ROOT } : {}),
    identities,
    maxBodyBytes: integer(
      environment.PASS_BUILDER_MAX_BODY_BYTES,
      20_000_000,
      1_000_000,
      50_000_000,
    ),
    maxConcurrentBuilds: integer(environment.PASS_BUILDER_MAX_CONCURRENCY, 4, 1, 32),
    processTimeoutMs: integer(environment.PASS_BUILDER_PROCESS_TIMEOUT_MS, 30_000, 1_000, 120_000),
    diagnosticErrors,
  };
}
