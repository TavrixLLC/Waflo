import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import {
  cardLocalePresentation,
  cardLocaleRegistry,
  walletStructuralCopyForLocale,
} from "@waflo/contracts";
import { validateSigningCertificate } from "./certificate.js";
import type { PassBuilderServiceConfiguration } from "./config.js";
import type { PassBuilderRequest, SigningIdentity } from "./contracts.js";
import { createPersonalizationProtobuf } from "./protobuf.js";
import { runExecutable } from "./subprocess.js";

export interface PassValidationResult {
  readonly valid: true;
  readonly warnings: readonly string[];
}

function containedPath(root: string, leaf: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, leaf);
  const pathFromRoot = relative(resolvedRoot, target);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".." || pathFromRoot.includes(sep)) {
    throw new Error("PASS_TEMPLATE_INVALID");
  }
  return target;
}

function safeValidationWarnings(output: string): readonly string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((line) => line.replace(/[A-Za-z0-9_-]{24,}/g, "[REDACTED]").slice(0, 240));
}

function applePassStrings(locale: string): string {
  const copy = walletStructuralCopyForLocale(locale);
  const quote = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const entries: readonly (readonly [string, string])[] = [
    ["STAMPS", copy.stamps],
    ["MEMBER", copy.member],
    ["PROGRAM", copy.program],
    ["STATUS", copy.status],
    ["REWARD", copy.reward],
    ["SECURITY", copy.security],
    ["Active", copy.active],
    ["Reward ready", copy.rewardReady],
    ["Transferred", copy.transferred],
    ["Temporarily paused", copy.paused],
    ["No longer valid", copy.invalid],
  ];
  return entries
    .map(([key, value]) => `"${quote(key)}" = "${quote(value)}";`)
    .join("\n")
    .concat("\n");
}

async function writeApplePassStrings(path: string, locale: string): Promise<void> {
  const contents = applePassStrings(locale);
  await writeFile(
    path,
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(contents, "utf16le")]),
    { mode: 0o600 },
  );
}

function toAppleRgb(hexOrRgb: string): string {
  if (hexOrRgb.startsWith("rgb(")) return hexOrRgb;
  const hex = hexOrRgb.trim().replace(/^#/, "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgb(${r},${g},${b})`;
}

/** Apple requires non-ASCII pass.strings in the produced pass to be UTF-16. */
async function materializeAppleLocalizedTemplate(
  source: string,
  destination: string,
): Promise<void> {
  await cp(source, destination, { recursive: true, errorOnExist: true });
  // A personalized pass can be displayed on a device in any locale Waflo
  // advertises. Generate every artifact directory from the same shared copy
  // contract used by issuance rather than leaving the build template EN/AR-only.
  await Promise.all(
    cardLocaleRegistry.map(async ({ id }) => {
      const directory = join(destination, `${cardLocalePresentation(id).appleLocale}.lproj`);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeApplePassStrings(join(directory, "pass.strings"), id);
    }),
  );
}

export class ApplePassBuilder {
  constructor(private readonly configuration: PassBuilderServiceConfiguration) {}

  async validate(request: PassBuilderRequest): Promise<PassValidationResult> {
    const result = await this.withPersonalizedPass(request, async ({ personalizedPath }) => {
      try {
        const validation = await runExecutable({
          executable: this.configuration.buildpassPath,
          arguments: ["validate", personalizedPath],
          timeoutMs: this.configuration.processTimeoutMs,
        });
        return { valid: true as const, warnings: safeValidationWarnings(validation.stdout) };
      } catch (cause) {
        throw new Error("PASS_VALIDATION_FAILED", { cause });
      }
    });
    return result;
  }

  async generate(request: PassBuilderRequest): Promise<Buffer> {
    const identity = this.requireIdentity(request);
    return this.withPersonalizedPass(request, async ({ workDirectory, personalizedPath }) => {
      try {
        await runExecutable({
          executable: this.configuration.buildpassPath,
          arguments: ["validate", personalizedPath],
          timeoutMs: this.configuration.processTimeoutMs,
        });
      } catch (cause) {
        throw new Error("PASS_VALIDATION_FAILED", { cause });
      }
      const password = (await readFile(identity.certificatePasswordFile, "utf8")).trim();
      if (password.length === 0 || password.length > 1_024) {
        throw new Error("PASS_CERTIFICATE_PASSWORD_INVALID");
      }
      const certificate = await validateSigningCertificate({
        identity,
        password,
        opensslPath: this.configuration.opensslPath,
        workDirectory,
        timeoutMs: this.configuration.processTimeoutMs,
      });
      const outputPath = join(workDirectory, "result.pkpass");
      try {
        await runExecutable({
          executable: this.configuration.buildpassPath,
          arguments: [
            "sign",
            personalizedPath,
            "--pass-certificate",
            identity.certificatePath,
            "--wwdr-certificate",
            certificate.wwdrCertificatePath,
            "--output",
            outputPath,
          ],
          environment: { BUILDPASS_PASS_CERTIFICATE_PASSWORD: password },
          timeoutMs: this.configuration.processTimeoutMs,
        });
      } catch (cause) {
        throw new Error("PASS_SIGNING_FAILED", { cause });
      }
      const result = await readFile(outputPath);
      if (result.length < 1_000 || result.length > this.configuration.maxBodyBytes) {
        throw new Error("PASS_OUTPUT_INVALID");
      }
      return result;
    });
  }

  private requireIdentity(request: PassBuilderRequest): SigningIdentity {
    const identity = this.configuration.identities.get(request.signingKeyId);
    if (!identity) throw new Error("PASS_SIGNING_IDENTITY_NOT_FOUND");
    if (!identity.merchantIds.includes("*") && !identity.merchantIds.includes(request.merchantId)) {
      throw new Error("PASS_SIGNING_IDENTITY_MISMATCH");
    }
    if (
      identity.passTypeIdentifier !== request.pass.passTypeIdentifier ||
      identity.teamIdentifier !== request.pass.teamIdentifier
    ) {
      throw new Error("PASS_SIGNING_IDENTITY_MISMATCH");
    }
    return identity;
  }

  private async withPersonalizedPass<T>(
    request: PassBuilderRequest,
    operation: (input: {
      readonly workDirectory: string;
      readonly personalizedPath: string;
    }) => Promise<T>,
  ): Promise<T> {
    this.requireIdentity(request);
    const prefix = join(this.configuration.tempRoot ?? tmpdir(), "waflo-pass-");
    const workDirectory = await mkdtemp(prefix);
    try {
      const templatePath = containedPath(
        this.configuration.templateRoot,
        `${request.templateId}.pkpasstemplate`,
      );
      let realTemplateRoot: string;
      let realTemplatePath: string;
      try {
        [realTemplateRoot, realTemplatePath] = await Promise.all([
          realpath(this.configuration.templateRoot),
          realpath(templatePath),
        ]);
      } catch {
        throw new Error("PASS_TEMPLATE_INVALID");
      }
      const pathFromRealRoot = relative(realTemplateRoot, realTemplatePath);
      if (
        pathFromRealRoot.startsWith(`..${sep}`) ||
        pathFromRealRoot === ".." ||
        !(await stat(realTemplatePath)).isDirectory()
      ) {
        throw new Error("PASS_TEMPLATE_INVALID");
      }
      const localizedTemplatePath = join(workDirectory, "localized-template.pkpasstemplate");
      await materializeAppleLocalizedTemplate(realTemplatePath, localizedTemplatePath);
      const templatePassJsonPath = join(localizedTemplatePath, "pass.json");
      try {
        const templatePassJson = JSON.parse(await readFile(templatePassJsonPath, "utf8")) as Record<
          string,
          unknown
        >;
        const bg = toAppleRgb(request.pass.backgroundColor);
        templatePassJson.backgroundColor = bg;
        templatePassJson.footerBackgroundColor = request.pass.footerBackgroundColor
          ? toAppleRgb(request.pass.footerBackgroundColor)
          : bg;
        await writeFile(templatePassJsonPath, JSON.stringify(templatePassJson, null, 2), "utf8");
      } catch {
        // preserve template pass.json if unreadable
      }
      const protobufPath = await createPersonalizationProtobuf({
        request,
        protobufRoot: this.configuration.protobufRoot,
        workDirectory,
      });
      const personalizedPath = join(workDirectory, "personalized.pass");
      try {
        await runExecutable({
          executable: this.configuration.buildpassPath,
          arguments: [
            "personalize",
            localizedTemplatePath,
            "--protobuf",
            protobufPath,
            "--output",
            personalizedPath,
          ],
          timeoutMs: this.configuration.processTimeoutMs,
        });
      } catch (cause) {
        throw new Error("PASS_PERSONALIZATION_FAILED", { cause });
      }
      const personalizedPassJsonPath = join(personalizedPath, "pass.json");
      try {
        const personalizedPassJson = JSON.parse(
          await readFile(personalizedPassJsonPath, "utf8"),
        ) as Record<string, unknown>;
        const bg = toAppleRgb(request.pass.backgroundColor);
        personalizedPassJson.footerBackgroundColor = request.pass.footerBackgroundColor
          ? toAppleRgb(request.pass.footerBackgroundColor)
          : bg;
        await writeFile(
          personalizedPassJsonPath,
          JSON.stringify(personalizedPassJson, null, 2),
          "utf8",
        );
      } catch {
        // preserve personalized pass.json if unreadable
      }
      return await operation({ workDirectory, personalizedPath });
    } finally {
      await rm(workDirectory, { recursive: true, force: true, maxRetries: 2 });
    }
  }
}
