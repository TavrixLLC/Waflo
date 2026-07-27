import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { EnvironmentService } from "../config/environment.service.js";

interface Bucket {
  count: number;
  expiresAt: number;
}

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly memory = new Map<string, Bucket>();
  private readonly redis: Redis | null;
  private readonly namespace: string;

  constructor(environment: EnvironmentService) {
    this.namespace = environment.values.RATE_LIMIT_NAMESPACE;
    this.redis = environment.values.REDIS_URL
      ? new Redis(environment.values.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        })
      : null;
    this.redis?.on("error", () => undefined);
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const storageKey = `${this.namespace}:${key}`;
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        const count = await this.redis.incr(storageKey);
        if (count === 1) await this.redis.expire(storageKey, windowSeconds);
        return count <= limit;
      } catch {
        // Development-safe in-memory fallback. Production readiness reports Redis failures.
      }
    }

    const now = Date.now();
    const current = this.memory.get(storageKey);
    if (!current || current.expiresAt <= now) {
      this.memory.set(storageKey, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis?.status === "ready") await this.redis.quit();
  }
}
