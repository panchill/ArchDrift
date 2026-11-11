import type { CalmModel } from "./types";
export type Read = { name: string; size: number } & ({ ok: true; model: CalmModel } | { ok: false; error: string });
export async function readModelFile(file: File): Promise<Read> {
  const info = { name: file.name, size: file.size };
  const fail = (error: string): Read => ({ ...info, ok: false, error });
  if (file.size > 16 * 1024 * 1024) return fail("Файл больше 16 МБ.");
  let source: string;
  try { source = await file.text(); } catch { return fail("Не удалось прочитать файл. Выберите его ещё раз."); }
  let model: unknown;
  try { model = JSON.parse(source); } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const position = message.match(/position (\d+)/)?.[1];
    const line = message.match(/line (\d+)/)?.[1] ?? (position ? source.slice(0, Number(position)).split("\n").length : undefined);
    return fail(`Это не JSON${line ? `: строка ${line}` : ""}. Нужен файл CALM 1.2 в формате JSON.`);
  }
  if (!model || typeof model !== "object" || !Array.isArray((model as CalmModel).nodes) || !Array.isArray((model as CalmModel).relationships))
    return fail("Это JSON, но не CALM-модель: нет списков nodes и relationships.");
  return { ...info, ok: true, model: model as CalmModel };
}
