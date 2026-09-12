import {
  ArgumentsHost,
  Catch,
  Inject,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { createErrorEnvelope } from "@waflo/contracts";
import { sanitizeErrorForReporting } from "@waflo/security";
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./app-error.js";
import { ERROR_REPORTER, type ErrorReporter } from "./error-reporter.js";
import type { WafloRequest } from "./request-context.js";

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  constructor(@Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<WafloRequest>();
    const reply = context.getResponse<FastifyReply>();
    const requestId = request.requestId || request.id;

    if (exception instanceof AppError) {
      reply
        .status(exception.status)
        .send(createErrorEnvelope(exception.code, exception.message, requestId, exception.details));
      return;
    }

    if (exception instanceof ZodError) {
      reply.status(HttpStatus.UNPROCESSABLE_ENTITY).send(
        createErrorEnvelope(
          "VALIDATION_FAILED",
          "Please check the submitted information.",
          requestId,
          {
            fields: exception.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        ),
      );
      return;
    }

    if (exception instanceof HttpException) {
      reply
        .status(exception.getStatus())
        .send(
          createErrorEnvelope(
            "REQUEST_REJECTED",
            exception.getStatus() >= 500 ? "Something went wrong." : exception.message,
            requestId,
          ),
        );
      return;
    }

    // @fastify/multipart and Fastify reject oversized or malformed multipart
    // requests before a controller can turn them into a domain error. Preserve
    // a stable, non-sensitive response for the asset uploader instead of
    // surfacing the generic internal-error envelope.
    const fastifyCode =
      typeof exception === "object" && exception !== null && "code" in exception
        ? (exception as { code?: unknown }).code
        : undefined;
    if (typeof fastifyCode === "string") {
      const multipartStatus =
        fastifyCode === "FST_REQ_FILE_TOO_LARGE" || fastifyCode === "FST_ERR_CTP_BODY_TOO_LARGE"
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : fastifyCode === "FST_FILES_LIMIT" ||
              fastifyCode === "FST_FIELDS_LIMIT" ||
              fastifyCode === "FST_PARTS_LIMIT" ||
              fastifyCode === "FST_INVALID_MULTIPART_CONTENT_TYPE"
            ? HttpStatus.UNPROCESSABLE_ENTITY
            : null;
      if (multipartStatus) {
        reply
          .status(multipartStatus)
          .send(
            createErrorEnvelope(
              fastifyCode === "FST_REQ_FILE_TOO_LARGE" ||
                fastifyCode === "FST_ERR_CTP_BODY_TOO_LARGE"
                ? "ASSET_UPLOAD_TOO_LARGE"
                : "ASSET_MULTIPART_INVALID",
              multipartStatus === HttpStatus.PAYLOAD_TOO_LARGE
                ? "The image must be smaller than 2 MB."
                : "The image upload is incomplete or invalid.",
              requestId,
            ),
          );
        return;
      }
    }

    request.log.error(
      { err: sanitizeErrorForReporting(exception), requestId },
      "Unhandled API error",
    );
    void Promise.resolve(
      this.reporter.captureException(exception, {
        requestId,
        component: "api",
        operation: `${request.method} ${request.routeOptions?.url ?? "unknown"}`,
      }),
    ).catch(() => undefined);
    reply
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .send(createErrorEnvelope("INTERNAL_ERROR", "Something went wrong.", requestId));
  }
}
