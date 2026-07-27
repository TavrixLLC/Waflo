import { HttpStatus, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { AppError } from "../common/app-error.js";
import { EnvironmentService } from "../config/environment.service.js";

interface Bucket {
  count: number;
  expiresAt: number;
}

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private static readonly MAX_MEMORY_BUCKETS = 10_000;
  private readonly memory = new Map<string, Bucket>();
  private readonly redis: Redis | null;
  private readonly namespace: string;
  private readonly production: boolean;

  constructor(environment: EnvironmentService) {
    this.namespace = environment.values.RATE_LIMIT_NAMESPACE;
    this.production = environment.values.NODE_ENV === "production";
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
        if (this.production) {
          throw new AppError(
            "RATE_LIMIT_STORAGE_UNAVAILABLE",
            "Request protection is temporarily unavailable.",
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
      }
    }

    const now = Date.now();
    this.pruneMemory(now);
    const current = this.memory.get(storageKey);
    if (!current || current.expiresAt <= now) {
      this.memory.set(storageKey, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  }

  async assertReady(): Promise<void> {
    if (!this.redis) {
      if (this.production) throw new Error("Production rate-limit Redis is not configured.");
      return;
    }
    if (this.redis.status === "wait") await this.redis.connect();
    const response = await this.redis.ping();
    if (response !== "PONG") throw new Error("Redis readiness check did not return PONG.");
  }

  private pruneMemory(now: number): void {
    for (const [key, bucket] of this.memory) {
      if (bucket.expiresAt <= now) this.memory.delete(key);
    }
    while (this.memory.size >= RateLimitService.MAX_MEMORY_BUCKETS) {
      const oldestKey = this.memory.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.memory.delete(oldestKey);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis?.status === "ready") {
      await this.redis.quit();
    } else {
      this.redis?.disconnect();
    }
  }
}
