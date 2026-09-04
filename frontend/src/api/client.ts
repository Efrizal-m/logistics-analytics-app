import type { AskResponse, ChartPayload, KpisPayload, SchemaResponse } from "../types";
import { readStoredToken } from "../token";

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

// Called on any 401 except from /api/login itself - session.ts registers its
// force-logout here. A 401 from login means "wrong password", not "session
// expired", so it must not trigger the same handler or a failed login
// attempt would wipe out whatever (if anything) was previously signed in and
// swallow the error message the login form needs to show.
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // A Headers instance merges correctly regardless of argument order, unlike
  // spreading two plain objects (`{...a, ...b}` lets b's `headers` key
  // replace a's outright rather than merge the fields inside it).
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const token = readStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });

  if (!response.ok) {
    if (response.status === 401 && path !== "/api/login") onUnauthorized?.();

    // FastAPI puts the useful message in `detail`; surface it rather than a
    // bare status code, because these carry real explanations (an unsupported
    // query, a missing API key, an expired session).
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
  login: (username: string, password: string) =>
    request<{ token: string; username: string; expires_at: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
};
