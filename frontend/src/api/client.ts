import type { AskResponse, ChartPayload, KpisPayload, SchemaResponse } from "../types";

export const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!response.ok) {
    // FastAPI puts the useful message in `detail`; surface it rather than a
    // bare status code, because these carry real explanations (an unsupported
    // query, a missing API key).
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* response had no JSON body */
    }
    throw new ApiError(detail, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  schema: () => request<SchemaResponse>("/api/schema"),
  kpis: () => request<KpisPayload>("/api/kpis"),
  chartNames: () => request<string[]>("/api/charts"),
  chart: (name: string) => request<ChartPayload>(`/api/charts/${name}`),
  ask: (question: string) =>
    request<AskResponse>("/api/ask", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),
};
