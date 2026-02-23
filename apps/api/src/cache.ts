import { Redis } from "ioredis";
import type { FastifyBaseLogger } from "fastify";

export type CacheType = "redis" | "memory";

export type CacheStore = {
  type: CacheType;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
};

type CacheRecord = {
  value: string;
  expiresAt: number | null;
};

class MemoryCacheStore implements CacheStore {
  public type: CacheType = "memory";
  private readonly values = new Map<string, CacheRecord>();

  async get(key: string): Promise<string | null> {
    const found = this.values.get(key);
    if (!found) {
      return null;
    }

    if (found.expiresAt !== null && found.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }

    return found.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.values.set(key, { value, expiresAt });
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.values.clear();
  }
}

class RedisCacheStore implements CacheStore {
  public type: CacheType = "redis";

  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.redis.set(key, value, "EX", ttlSeconds);
      return;
    }
    await this.redis.set(key, value);
  }

  async ping(): Promise<boolean> {
    const pong = await this.redis.ping();
    return pong === "PONG";
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

export async function createCacheStore(
  redisUrl: string,
  logger: FastifyBaseLogger
): Promise<CacheStore> {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });

  try {
    await redis.connect();
    await redis.ping();
    logger.info({ redisUrl }, "Connected to Redis");
    return new RedisCacheStore(redis);
  } catch (error) {
    logger.warn({ error }, "Redis unavailable, fallback to in-memory cache");
    redis.disconnect();
    return new MemoryCacheStore();
  }
}
