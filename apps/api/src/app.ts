import "reflect-metadata";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { parseEnvironment } from "@waflo/config";
import { sanitizeRequestUrl } from "@waflo/security";
import type { FastifyRequest } from "fastify";
import { AppModule } from "./app.module.js";
import { EnvironmentService } from "./config/environment.service.js";

export interface CreateApiApplicationOptions {
  logger?: boolean;
}

export function serializeHttpRequest(
  request: Pick<FastifyRequest, "method" | "url" | "hostname" | "ip" | "socket">,
) {
  return {
    method: request.method,
    url: sanitizeRequestUrl(request.url),
    hostname: request.hostname,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort ?? 0,
  };
}

export async function createApiApplication(
  options: CreateApiApplicationOptions = {},
): Promise<NestFastifyApplication> {
  const parsedEnvironment = parseEnvironment(process.env);
  const trustedProxies = parsedEnvironment.TRUSTED_PROXIES.split(",")
    .map((proxy) => proxy.trim())
    .filter(Boolean);
  const adapter = new FastifyAdapter({
    logger:
      options.logger === false
        ? false
        : {
            level: parsedEnvironment.LOG_LEVEL,
            redact: {
              paths: [
                "req.headers.cookie",
                "req.headers.authorization",
                "req.headers['stripe-signature']",
                "password",
                "*.password",
                "*.token",
                "req.headers['x-waflo-signature']",
                "req.headers['x-waflo-nonce']",
                "req.headers['x-waflo-body-sha256']",
                "*.qrPayload",
                "*.pairingToken",
                "*.refreshToken",
                "*.signature",
                "*.nonce",
              ],
              censor: "[REDACTED]",
            },
            serializers: {
              req(request: FastifyRequest) {
                return serializeHttpRequest(request);
              },
            },
          },
    trustProxy: trustedProxies.length > 0 ? [...trustedProxies] : false,
    bodyLimit: 1024 * 1024,
    requestIdHeader: "x-request-id",
    genReqId: (request: IncomingMessage) => {
      const candidate = request.headers["x-request-id"];
      return typeof candidate === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(candidate)
        ? candidate
        : randomUUID();
    },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    rawBody: true,
    ...(options.logger === false ? { logger: false } : {}),
  });
  const environment = app.get(EnvironmentService);

  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, {
    limits: {
      files: 1,
      fields: 8,
      fileSize: 2 * 1024 * 1024,
    },
  });
  await app.register(fastifyHelmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    hsts:
      environment.values.NODE_ENV === "production"
        ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
        : false,
  });
  app.enableCors({
    origin: [...environment.allowedOrigins],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-csrf-token",
      "x-request-id",
      "x-idempotency-key",
      "x-waflo-device-id",
      "x-waflo-device-session-id",
      "x-waflo-request-id",
      "x-waflo-timestamp",
      "x-waflo-nonce",
      "x-waflo-body-sha256",
      "x-waflo-signature",
    ],
    exposedHeaders: ["x-request-id"],
  });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", (request, reply, done) => {
    reply.header("x-request-id", request.id);
    reply.header("cache-control", "no-store");
    reply.header("referrer-policy", "no-referrer");
    done();
  });

  if (environment.values.NODE_ENV !== "production") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("Waflo Platform API")
      .setDescription(
        "Authoritative Waflo W4 API for merchant administration and signed Staff devices.",
      )
      .setVersion("1.0")
      .addCookieAuth(environment.values.COOKIE_NAME)
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("docs", app, document, {
      jsonDocumentUrl: "docs/openapi.json",
    });
  }

  await app.init();
  return app;
}
