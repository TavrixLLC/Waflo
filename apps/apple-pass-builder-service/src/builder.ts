import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
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
            realTemplatePath,
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
      return await operation({ workDirectory, personalizedPath });
    } finally {
      await rm(workDirectory, { recursive: true, force: true, maxRetries: 2 });
    }
  }
}
