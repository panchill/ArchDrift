import type { Analysis, Architecture, CalmModel } from "./types";
import { mockValidation } from "./mockValidation";

export const JAEGER = (import.meta.env.VITE_JAEGER_URL ?? "http://localhost:8080/jaeger/ui").replace(/\/$/, "");
export interface ErrorBody { code: string; message: string; details?: { field: string; message: string }[] }
export class ApiError extends Error {
  constructor(public status: number, public body?: ErrorBody) { super(`HTTP ${status}`); }
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = response.headers.get("content-type")?.includes("json")
      ? await response.json().catch(() => undefined) : undefined;
    throw new ApiError(response.status, body);
  }
  return response.json();
}
let mockArchitecture: Architecture | undefined;
export async function loadArchitecture(signal: AbortSignal): Promise<Architecture | null> {
  signal.throwIfAborted();
  if (mockArchitecture) return mockArchitecture;
  try {
    return await request<Architecture>(`${import.meta.env.BASE_URL}mocks/architecture.json`, { signal });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
export async function loadAnalysis(signal: AbortSignal): Promise<Analysis | null> {
  try {
    const result = await request<Analysis>(`${import.meta.env.BASE_URL}mocks/analysis.json`, { signal });
    // Mock uploads simulate saving only; telemetry remains the supplied fixture.
    return mockArchitecture ? { ...result, architectureVersion: mockArchitecture.version } : result;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.body?.code === "architecture_not_configured") return null;
    throw e;
  }
}
export async function uploadArchitecture(model: CalmModel, currentVersion: number): Promise<Architecture> {
  const details = mockValidation(model);
  if (details.length) throw new ApiError(400, { code: "validation_error", message: "Invalid model", details });
  const revision = (version: number): CalmModel => ({ ...model, metadata: { ...model.metadata, archdrift: { ...model.metadata?.archdrift, version } } });
  // UI-only preview: saving never sends a request or recomputes drift.
  mockArchitecture = { version: currentVersion + 1, updatedAt: new Date().toISOString(), model: revision(currentVersion + 1) };
  return mockArchitecture;
}
