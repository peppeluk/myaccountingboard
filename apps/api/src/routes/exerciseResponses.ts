import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";

const querySchema = z.object({
  exerciseId: z.string().min(1)
});

export function registerExerciseResponseRoutes(app: FastifyInstance, config: AppConfig) {
  app.get("/api/exercise-responses", async (request, reply) => {
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

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Missing exerciseId" };
    }

    const url = new URL(`${config.SUPABASE_URL}/rest/v1/exercise_responses`);
    url.searchParams.set(
      "select",
      "id,exercise_id,student_name,board_json,journal_entries,created_at"
    );
    url.searchParams.set("exercise_id", `eq.${parsed.data.exerciseId}`);
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
