import type { ApiResponse } from "@relayops/shared/adminApi";

export async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? `Request failed with status ${response.status}` : payload.error.message);
  }

  return payload.data;
}
