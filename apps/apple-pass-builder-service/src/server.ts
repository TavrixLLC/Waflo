import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { ApplePassBuilder } from "./builder.js";
import { applePassBuilderRevision, type PassBuilderServiceConfiguration } from "./config.js";
import { parsePassBuilderRequest, RequestValidationError } from "./contracts.js";

interface MetricState {
  generationTotal: number;
  generationFailedTotal: number;
  generationDurationSeconds: number;
  generationDurationCount: number;
  validationFailedTotal: number;
  signingFailedTotal: number;
}

class BuildGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly limit: number,
    private readonly maximumQueue = limit * 4,
  ) {}

  async enter(): Promise<() => void> {
    if (this.active >= this.limit) {
      if (this.waiters.length >= this.maximumQueue)
        throw new ServiceError(503, "PASS_BUILDER_BUSY");
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }
}

export class PassBuilderHttpService {
  private readonly builder: ApplePassBuilder;
  private readonly gate: BuildGate;
  private readonly metrics: MetricState = {
    generationTotal: 0,
    generationFailedTotal: 0,
    generationDurationSeconds: 0,
    generationDurationCount: 0,
    validationFailedTotal: 0,
    signingFailedTotal: 0,
  };

  constructor(
    private readonly configuration: PassBuilderServiceConfiguration,
    private readonly certificateExpirations: ReadonlyMap<string, string> = new Map(),
  ) {
    this.builder = new ApplePassBuilder(configuration);
    this.gate = new BuildGate(configuration.maxConcurrentBuilds);
  }

  createServer() {
    const server = createServer((request, response) => void this.handle(request, response));
    server.requestTimeout = this.configuration.processTimeoutMs + 10_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 50;
    server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
    return server;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://pass-builder.internal");
      if (request.method === "GET" && url.pathname === "/health") {
        this.json(response, 200, {
          status: "ready",
          passBuilderRevision: applePassBuilderRevision,
          signingKeyIds: [...this.configuration.identities.keys()].sort(),
          signingIdentities: [...this.configuration.identities.keys()]
            .sort()
            .map((id) => ({ id, expiresAt: this.certificateExpirations.get(id) })),
        });
        return;
      }
      this.authorize(request);
      if (request.method === "GET" && url.pathname === "/metrics") {
        response.writeHead(200, {
          "content-type": "text/plain; version=0.0.4; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(this.prometheusMetrics());
        return;
      }
      if (
        request.method !== "POST" ||
        !["/v1/passes/generate", "/v1/passes/validate"].includes(url.pathname)
      ) {
        throw new ServiceError(404, "NOT_FOUND");
      }
      if (request.headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/json") {
        throw new ServiceError(415, "UNSUPPORTED_MEDIA_TYPE");
      }
      const input = parsePassBuilderRequest(
        JSON.parse((await this.body(request)).toString("utf8")),
      );
      const release = await this.gate.enter();
      const startedAt = performance.now();
      try {
        if (url.pathname === "/v1/passes/validate") {
          const result = await this.builder.validate(input);
          this.json(response, 200, result);
          this.log("pass_validation_completed", input, startedAt);
          return;
        }
        this.metrics.generationTotal += 1;
        const artifact = await this.builder.generate(input);
        this.metrics.generationDurationCount += 1;
        this.metrics.generationDurationSeconds += (performance.now() - startedAt) / 1_000;
        response.writeHead(200, {
          "content-type": "application/vnd.apple.pkpass",
          "content-length": artifact.length,
          "cache-control": "private, no-store",
          "x-pass-builder-revision": applePassBuilderRevision,
          "x-content-type-options": "nosniff",
        });
        response.end(artifact);
        this.log("pass_generation_completed", input, startedAt);
      } catch (error) {
        if (url.pathname === "/v1/passes/generate") this.metrics.generationFailedTotal += 1;
        if (this.errorCode(error).includes("VALID")) this.metrics.validationFailedTotal += 1;
        if (
          this.errorCode(error).includes("SIGN") ||
          this.errorCode(error).includes("CERTIFICATE")
        ) {
          this.metrics.signingFailedTotal += 1;
        }
        this.log(
          "pass_operation_failed",
          input,
          startedAt,
          this.errorCode(error),
          this.diagnostic(error),
        );
        throw error;
      } finally {
        release();
      }
    } catch (error) {
      const serviceError = this.publicError(error);
      if (!response.headersSent)
        this.json(response, serviceError.status, { error: serviceError.code });
      else response.destroy();
    }
  }

  private authorize(request: IncomingMessage) {
    const match = /^Bearer ([A-Za-z0-9._~-]{32,256})$/.exec(request.headers.authorization ?? "");
    const supplied = Buffer.from(match?.[1] ?? "", "utf8");
    if (
      supplied.length !== this.configuration.authToken.length ||
      !timingSafeEqual(supplied, this.configuration.authToken)
    ) {
      throw new ServiceError(401, "UNAUTHORIZED");
    }
  }

  private async body(request: IncomingMessage): Promise<Buffer> {
    const length = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(length) && length > this.configuration.maxBodyBytes) {
      throw new ServiceError(413, "REQUEST_TOO_LARGE");
    }
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      received += bytes.length;
      if (received > this.configuration.maxBodyBytes)
        throw new ServiceError(413, "REQUEST_TOO_LARGE");
      chunks.push(bytes);
    }
    if (received === 0) throw new ServiceError(400, "PASS_REQUEST_INVALID");
    return Buffer.concat(chunks, received);
  }

  private publicError(error: unknown): ServiceError {
    if (error instanceof ServiceError) return error;
    if (error instanceof RequestValidationError || error instanceof SyntaxError) {
      return new ServiceError(400, "PASS_REQUEST_INVALID");
    }
    const code = this.errorCode(error);
    if (code.includes("IDENTITY_NOT_FOUND")) return new ServiceError(404, code);
    if (
      code.includes("INVALID") ||
      code.includes("MISMATCH") ||
      code.includes("IMAGE") ||
      code.includes("TEMPLATE") ||
      code.includes("PERSONALIZATION") ||
      code.includes("VALIDATION")
    ) {
      return new ServiceError(422, code);
    }
    if (code.includes("PASSWORD") || code.includes("CERTIFICATE") || code.includes("SIGN")) {
      return new ServiceError(503, "PASS_SIGNING_FAILED");
    }
    return new ServiceError(503, "PASS_BUILDER_FAILED");
  }

  private errorCode(error: unknown): string {
    const raw =
      error instanceof Error
        ? (error.message.split(":", 1)[0] ?? "PASS_BUILDER_FAILED")
        : "PASS_BUILDER_FAILED";
    if (!/^PASS_[A-Z0-9_]+$/.test(raw)) return "PASS_BUILDER_FAILED";
    return raw;
  }

  private diagnostic(error: unknown): string | undefined {
    if (!this.configuration.diagnosticErrors) return undefined;
    let candidate: unknown = error;
    for (let depth = 0; depth < 4 && candidate instanceof Error; depth += 1) {
      const processError = candidate as Error & {
        stdout?: unknown;
        stderr?: unknown;
        cause?: unknown;
      };
      const output = [processError.stdout, processError.stderr]
        .filter((value): value is string => typeof value === "string")
        .join("\n")
        .trim();
      if (output) {
        return output
          .replaceAll(this.configuration.tempRoot ?? "/tmp", "[TEMP]")
          .replace(/[A-Za-z0-9._~-]{32,}/g, "[REDACTED]")
          .slice(0, 1_000);
      }
      candidate = processError.cause;
    }
    return undefined;
  }

  private json(response: ServerResponse, status: number, body: unknown) {
    const bytes = Buffer.from(JSON.stringify(body), "utf8");
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": bytes.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(bytes);
  }

  private log(
    event: string,
    input: { operationId: string; merchantId: string; pass: { serialNumber: string } },
    startedAt: number,
    errorCode?: string,
    diagnostic?: string,
  ) {
    process.stdout.write(
      `${JSON.stringify({
        level: errorCode ? "error" : "info",
        component: "apple-pass-builder-service",
        event,
        operationId: input.operationId,
        merchantId: input.merchantId,
        serialNumber: input.pass.serialNumber,
        durationMs: Math.round(performance.now() - startedAt),
        ...(errorCode ? { errorCode } : {}),
        ...(diagnostic ? { diagnostic } : {}),
      })}\n`,
    );
  }

  private prometheusMetrics(): string {
    return [
      "# TYPE wallet_pass_generation_total counter",
      `wallet_pass_generation_total ${this.metrics.generationTotal}`,
      "# TYPE wallet_pass_generation_failed_total counter",
      `wallet_pass_generation_failed_total ${this.metrics.generationFailedTotal}`,
      "# TYPE wallet_pass_generation_duration_seconds summary",
      `wallet_pass_generation_duration_seconds_sum ${this.metrics.generationDurationSeconds}`,
      `wallet_pass_generation_duration_seconds_count ${this.metrics.generationDurationCount}`,
      "# TYPE wallet_pass_validation_failed_total counter",
      `wallet_pass_validation_failed_total ${this.metrics.validationFailedTotal}`,
      "# TYPE wallet_pass_signing_failed_total counter",
      `wallet_pass_signing_failed_total ${this.metrics.signingFailedTotal}`,
      "",
    ].join("\n");
  }
}

class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export function configurationFingerprint(configuration: PassBuilderServiceConfiguration): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        passBuilderRevision: applePassBuilderRevision,
        signingKeyIds: [...configuration.identities.keys()].sort(),
        templateRoot: configuration.templateRoot,
      }),
    )
    .digest("hex");
}
