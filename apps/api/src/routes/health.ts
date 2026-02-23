import type { FastifyInstance } from "fastify";
import type { CacheStore } from "../cache.js";

export function registerHealthRoutes(
  app: FastifyInstance,
  deps: { cache: CacheStore; startedAt: number }
): void {
  app.get("/health", async () => {
    const cacheHealthy = await deps.cache.ping();

    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Number(((Date.now() - deps.startedAt) / 1000).toFixed(1)),
      cache: {
        type: deps.cache.type,
        healthy: cacheHealthy
      }
    } as const;
  });
}
