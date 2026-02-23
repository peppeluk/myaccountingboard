import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  CORS_ORIGIN: z.string().default("http://localhost:5173")
});

export type AppConfig = z.infer<typeof envSchema>;

export function readConfig(): AppConfig {
  return envSchema.parse(process.env);
}
