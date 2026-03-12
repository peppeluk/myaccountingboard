import { z } from "zod";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultTemplatePath = resolve(currentDir, "..", "templates", "t-smart-template.xlsx");
const defaultOfficeTemplatePath = resolve(
  currentDir,
  "..",
  "templates",
  "t-smart-office-template.xlsx"
);

loadEnv({ path: resolve(currentDir, "..", ".env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  JOURNAL_TEMPLATE_PATH: z.string().default(defaultTemplatePath),
  JOURNAL_TEMPLATE_OFFICE_PATH: z.string().default(defaultOfficeTemplatePath),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  TEACHER_TOKEN: z.string().optional()
});

export type AppConfig = z.infer<typeof envSchema>;

export function readConfig(): AppConfig {
  return envSchema.parse(process.env);
}
