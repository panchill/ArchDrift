import type { Snapshot, Architecture, Analysis } from "./types";

// Fixtures mirror the two REST responses. The UI never derives drift from CALM.
async function readJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}mocks/${path}`, {
    signal,
  });
  if (!response.ok)
    throw new Error(`Не удалось загрузить ${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
export async function loadSnapshot(signal: AbortSignal): Promise<Snapshot> {
  const [architecture, analysis] = await Promise.all([
    readJson<Architecture>("architecture.json", signal),
    readJson<Analysis>("analysis.json", signal),
  ]);
  if (
    architecture.version !== analysis.architectureVersion ||
    architecture.version !== architecture.model.metadata?.archdrift?.version
  ) {
    throw new Error(
      "Версии архитектуры и анализа не совпадают. Обновите данные.",
    );
  }
  return { architecture, analysis };
}
