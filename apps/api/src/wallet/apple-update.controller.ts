import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { appleLogsSchema, appleRegistrationSchema } from "@waflo/contracts";
import type { FastifyReply } from "fastify";
import { Public, RateLimit, SkipCsrf } from "../common/decorators.js";
import type { WafloRequest } from "../common/request-context.js";
import { parseInput } from "../common/validation.js";
import { AppleUpdateService } from "./apple-update.service.js";

@Controller("v1/apple-wallet/v1")
@Public()
@SkipCsrf()
export class AppleUpdateController {
  constructor(private readonly updates: AppleUpdateService) {}

  @Post("devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber")
  @RateLimit(60)
  async register(
    @Param("deviceLibraryIdentifier") deviceLibraryIdentifier: string,
    @Param("passTypeIdentifier") passTypeIdentifier: string,
    @Param("serialNumber") serialNumber: string,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
    @Req() request: WafloRequest,
    @Res() reply: FastifyReply,
  ) {
    const input = parseInput(appleRegistrationSchema, body);
    const result = await this.updates.register(
      deviceLibraryIdentifier,
      passTypeIdentifier,
      serialNumber,
      input.pushToken,
      authorization,
      request,
    );
    reply.status(result.created ? 201 : 200).send();
  }

  @Delete("devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber")
  @RateLimit(60)
  async unregister(
    @Param("deviceLibraryIdentifier") deviceLibraryIdentifier: string,
    @Param("passTypeIdentifier") passTypeIdentifier: string,
    @Param("serialNumber") serialNumber: string,
    @Headers("authorization") authorization: string | undefined,
    @Req() request: WafloRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.updates.unregister(
      deviceLibraryIdentifier,
      passTypeIdentifier,
      serialNumber,
      authorization,
      request,
    );
    reply.status(200).send();
  }

  @Get("devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier")
  @RateLimit(120)
  async serials(
    @Param("deviceLibraryIdentifier") deviceLibraryIdentifier: string,
    @Param("passTypeIdentifier") passTypeIdentifier: string,
    @Query("passesUpdatedSince") passesUpdatedSince: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const result = await this.updates.updatedSerials(
      deviceLibraryIdentifier,
      passTypeIdentifier,
      passesUpdatedSince,
    );
    if (!result) {
      reply.status(204).send();
      return;
    }
    reply.header("content-type", "application/json").send(result);
  }

  @Get("passes/:passTypeIdentifier/:serialNumber")
  @RateLimit(120)
  async pass(
    @Param("passTypeIdentifier") passTypeIdentifier: string,
    @Param("serialNumber") serialNumber: string,
    @Headers("authorization") authorization: string | undefined,
    @Req() request: WafloRequest,
    @Res() reply: FastifyReply,
  ) {
    const artifact = await this.updates.updatedPass(
      passTypeIdentifier,
      serialNumber,
      authorization,
      request,
    );
    reply
      .header("content-type", "application/vnd.apple.pkpass")
      .header("cache-control", "private, no-store")
      .send(artifact);
  }

  @Post("log")
  @RateLimit(10, 60)
  async logs(@Body() body: unknown, @Req() request: WafloRequest, @Res() reply: FastifyReply) {
    const input = parseInput(appleLogsSchema, body);
    await this.updates.receiveLogs(input.logs, request);
    reply.status(200).send();
  }
}
