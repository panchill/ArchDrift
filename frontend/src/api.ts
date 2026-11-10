import type { Analysis } from "./types";

// The fixture mirrors GET /api/v1/analysis. The UI never derives drift from CALM.
export async function loadSnapshot(signal: AbortSignal): Promise<Analysis> {
  const response = await fetch(
    `${import.meta.env.BASE_URL}mocks/analysis.json`,
    {
      signal,
    },
  );
  if (!response.ok)
    throw new Error(
      `Не удалось загрузить analysis.json: HTTP ${response.status}`,
    );
  return response.json() as Promise<Analysis>;
}
