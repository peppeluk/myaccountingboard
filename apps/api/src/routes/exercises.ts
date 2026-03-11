import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";

export function registerExerciseRoutes(app: FastifyInstance, config: AppConfig) {
  app.get("/api/exercises", async (request, reply) => {
    if (!config.TEACHER_TOKEN) {
      reply.code(500);
      return { error: "Teacher token not configured" };
    }

    const teacherToken = request.headers["x-teacher-token"];
    if (!teacherToken || teacherToken !== config.TEACHER_TOKEN) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
      reply.code(500);
      return { error: "Supabase service role not configured" };
    }

    const url = new URL(`${config.SUPABASE_URL}/rest/v1/exercises`);
    url.searchParams.set("select", "id,title,created_at");
    url.searchParams.set("order", "created_at.desc");

    const response = await fetch(url, {
      headers: {
        apikey: config.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const bodyText = await response.text();
    if (!response.ok) {
      reply.code(response.status);
      return { error: bodyText };
    }

    try {
      return bodyText ? JSON.parse(bodyText) : [];
    } catch {
      reply.code(502);
      return { error: "Invalid response from Supabase" };
    }
  });
}
