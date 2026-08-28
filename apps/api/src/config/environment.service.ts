import { Injectable } from "@nestjs/common";
import { type Environment, parseEnvironment } from "@waflo/config";

@Injectable()
export class EnvironmentService {
  readonly values: Environment = parseEnvironment(process.env);

  get allowedOrigins(): readonly string[] {
    return this.values.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  get customerCsrfCookieName(): string {
    return this.values.NODE_ENV === "production"
      ? "__Host-waflo_customer_csrf"
      : "waflo_customer_csrf";
  }

  get adminCsrfCookieName(): string {
    return this.values.NODE_ENV === "production" ? "__Host-waflo_admin_csrf" : "waflo_admin_csrf";
  }

  get adminOrigin(): string {
    return new URL(this.values.ADMIN_DASHBOARD_URL).origin;
  }

  get stripeConfigured(): boolean {
    return Boolean(this.values.STRIPE_SECRET_KEY && this.values.STRIPE_WEBHOOK_SECRET);
  }

  get trustedProxies(): readonly string[] {
    return this.values.TRUSTED_PROXIES.split(",")
      .map((proxy) => proxy.trim())
      .filter(Boolean);
  }
}
