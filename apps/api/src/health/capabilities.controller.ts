import { Controller, Get } from "@nestjs/common";
import { ExternalAuthService } from "../auth/external-auth.service.js";
import { Public, RateLimit } from "../common/decorators.js";
import { WalletProviderRegistry } from "../wallet/wallet-provider.registry.js";

@Controller("v1/capabilities")
export class CapabilitiesController {
  constructor(
    private readonly externalAuth: ExternalAuthService,
    private readonly wallets: WalletProviderRegistry,
  ) {}

  @Get()
  @Public()
  @RateLimit(120)
  async get() {
    return {
      ...this.externalAuth.publicCapabilities(),
      ...(await this.wallets.publicCapabilities()),
    };
  }
}
