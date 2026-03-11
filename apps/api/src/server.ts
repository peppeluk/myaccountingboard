import Fastify from "fastify";
import cors from "@fastify/cors";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createCacheStore } from "./cache.js";
import { readConfig } from "./config.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerCacheRoutes } from "./routes/cache.js";
import { registerJournalRoutes } from "./routes/journal.js";
import { registerExerciseResponseRoutes } from "./routes/exerciseResponses.js";
import { registerExerciseRoutes } from "./routes/exercises.js";

export async function buildServer() {
  const config = readConfig();
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN
  });

  const cache = await createCacheStore(config.REDIS_URL, app.log);
  const startedAt = Date.now();

  app.get("/", async () => ({
    service: "myaccounting-api",
    status: "running",
    docs: ["/health", "/api/cache/:key"]
  }));

  registerHealthRoutes(app, { cache, startedAt });
  registerCacheRoutes(app, cache);
  registerJournalRoutes(app, config);
  registerExerciseRoutes(app, config);
  registerExerciseResponseRoutes(app, config);

  app.addHook("onClose", async () => {
    await cache.close();
  });

  return { app, config };
}

async function start() {
  const { app, config } = await buildServer();

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    app.log.info(`API running on http://${config.HOST}:${config.PORT}`);
  } catch (error) {
    app.log.error(error, "Failed to start API");
    process.exit(1);
  }
}

const currentFile = fileURLToPath(import.meta.url);
const executedFile = process.argv[1] ? resolve(process.argv[1]) : "";
const isMain = executedFile === currentFile;
if (isMain) {
  void start();
}
