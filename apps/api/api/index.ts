import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = (async () => {
      const { app } = await buildServer();
      await app.ready();
      return app;
    })();
  }
  return appPromise;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  try {
    const app = await getApp();
    app.server.emit("request", request, response);
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        message: "Errore interno inizializzazione API",
        error: error instanceof Error ? error.message : "unknown"
      })
    );
  }
}
