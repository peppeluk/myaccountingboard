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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

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
  fileName?: string
): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/journal/export`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      entries,
      fileName
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  return response.blob();
}
