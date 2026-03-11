export type HealthResponse = {
  status: "ok";
  timestamp: string;
  uptimeSeconds: number;
  cache: {
    type: "redis" | "memory";
    healthy: boolean;
  };
};

export type JournalEntryPayload = {
  date: string;
  accountName: string;
  description: string;
  debit: string;
  credit: string;
};

export type JournalTemplateKey = "t-smart" | "t-smart-office";
export type ExerciseResponseRow = {
  id: string;
  exercise_id: string;
  student_name: string | null;
  board_json: unknown;
  journal_entries: unknown;
  created_at: string;
};

export type ExerciseRow = {
  id: string;
  title: string | null;
  created_at: string | null;
};

const DEFAULT_API_BASE_URL =
  typeof window !== "undefined"
    ? window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : `${window.location.protocol}//${window.location.hostname}`
    : "http://localhost:3001";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export async function exportJournalWorkbook(
  entries: JournalEntryPayload[],
  fileName?: string,
  templateKey: JournalTemplateKey = "t-smart"
): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/journal/export`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      entries,
      fileName,
      templateKey
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  return response.blob();
}

export async function fetchExerciseResponses(
  exerciseId: string,
  teacherToken?: string
): Promise<ExerciseResponseRow[]> {
  return request<ExerciseResponseRow[]>(
    `/api/exercise-responses?exerciseId=${encodeURIComponent(exerciseId)}`,
    {
      headers: teacherToken ? { "x-teacher-token": teacherToken } : undefined
    }
  );
}

export async function fetchExercises(teacherToken?: string): Promise<ExerciseRow[]> {
  return request<ExerciseRow[]>("/api/exercises", {
    headers: teacherToken ? { "x-teacher-token": teacherToken } : undefined
  });
}
