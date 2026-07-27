import { Injectable } from "@nestjs/common";
import { parseEnvironment, type Environment } from "@waflo/config";

@Injectable()
export class EnvironmentService {
  readonly values: Environment = parseEnvironment(process.env);

  get allowedOrigins(): readonly string[] {
    return this.values.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  get stripeConfigured(): boolean {
    return Boolean(
      this.values.STRIPE_SECRET_KEY &&
        this.values.STRIPE_WEBHOOK_SECRET &&
        this.values.STRIPE_STARTER_MONTHLY_PRICE_ID &&
        this.values.STRIPE_GROWTH_MONTHLY_PRICE_ID &&
        this.values.STRIPE_SCALE_MONTHLY_PRICE_ID,
    );
  }

  get trustedProxies(): readonly string[] {
    return this.values.TRUSTED_PROXIES.split(",")
      .map((proxy) => proxy.trim())
      .filter(Boolean);
  }
}
