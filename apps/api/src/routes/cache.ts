import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CacheStore } from "../cache.js";

const keySchema = z.string().min(1).max(120).regex(/^[a-zA-Z0-9:_-]+$/);
const setValueBodySchema = z.object({
  value: z.string().min(1),
  ttlSeconds: z.number().int().positive().max(7 * 24 * 60 * 60).optional()
});

function parseKeyOrThrow(rawKey: string): string {
  const parsed = keySchema.safeParse(rawKey);
  if (!parsed.success) {
    throw new Error(
      "Chiave non valida. Usa solo lettere, numeri e i simboli : _ - (max 120 caratteri)."
    );
  }
  return parsed.data;
}

export function registerCacheRoutes(app: FastifyInstance, cache: CacheStore): void {
  app.get("/api/cache/:key", async (request, reply) => {
    try {
      const key = parseKeyOrThrow((request.params as { key: string }).key);
      const value = await cache.get(key);
      if (value === null) {
        return reply.code(404).send({
          message: "Chiave non trovata",
          key
        });
      }
      return {
        key,
        value,
        cache: cache.type
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Richiesta non valida"
      });
    }
  });

  app.put("/api/cache/:key", async (request, reply) => {
    try {
      const key = parseKeyOrThrow((request.params as { key: string }).key);
      const parsedBody = setValueBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({
          message: "Payload non valido",
          issues: parsedBody.error.issues
        });
      }

      await cache.set(key, parsedBody.data.value, parsedBody.data.ttlSeconds);
      return reply.code(201).send({
        message: "Valore salvato",
        key,
        cache: cache.type
      });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Richiesta non valida"
      });
    }
  });
}
