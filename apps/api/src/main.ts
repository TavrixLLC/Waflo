import "reflect-metadata";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { EnvironmentService } from "./config/environment.service.js";

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.headers['stripe-signature']",
          "password",
          "*.password",
          "*.token",
        ],
        censor: "[REDACTED]",
      },
    },
    trustProxy: process.env.NODE_ENV === "production",
    bodyLimit: 1024 * 1024,
    requestIdHeader: "x-request-id",
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    rawBody: true,
  });
  const environment = app.get(EnvironmentService);

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hsts: environment.values.NODE_ENV === "production",
  });
  app.enableCors({
    origin: [...environment.allowedOrigins],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-csrf-token", "x-request-id"],
    exposedHeaders: ["x-request-id"],
  });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Waflo Platform API")
    .setDescription(
      "Authoritative Waflo Phase W1 API for merchant web and future employee clients.",
    )
    .setVersion("1.0")
    .addCookieAuth(environment.values.COOKIE_NAME)
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "docs/openapi.json",
  });

  await app.listen(environment.values.API_PORT, "0.0.0.0");
}

void bootstrap();
