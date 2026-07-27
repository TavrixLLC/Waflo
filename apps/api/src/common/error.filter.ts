import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { createErrorEnvelope } from "@waflo/contracts";
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./app-error.js";
import type { WafloRequest } from "./request-context.js";

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
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

    request.log.error({ err: exception, requestId }, "Unhandled API error");
    reply
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .send(createErrorEnvelope("INTERNAL_ERROR", "Something went wrong.", requestId));
  }
}
