import { useEffect, useRef, useState } from "react";
import { ApiError, uploadArchitecture } from "./api";
import { STATUS_TEXT } from "./serverErrors";
import { calmFormatError, jsonLines } from "./jsonLines";
import { parseModel } from "./upload";
import type { Architecture } from "./types";

export function ModelEditor({ architecture, onSaved, onCancel }: {
  architecture: Architecture; onSaved: (value: Architecture) => void; onCancel: () => void;
}) {
  const initial = JSON.stringify(architecture.model, null, 2);
  const [source, setSource] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ message: string }[]>([]);
  const dialog = useRef<HTMLDialogElement>(null), pending = useRef(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (source === initial) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [source, initial]);
  function parse() {
    setErrors([]);
    if (new Blob([source]).size > 16 * 1024 * 1024) {
      setErrors([{ message: "Модель больше 16 МБ." }]); return null;
    }
    const result = parseModel(source);
    if (!result.ok) { setErrors([{ message: result.error }]); return null; }
    return result.model;
  }
  async function save() {
    if (pending.current) return;
    const model = parse();
    if (!model) return;
    pending.current = true; setBusy(true);
    try { onSaved(await uploadArchitecture(model, architecture.version, false)); }
    catch (e) {
      const details = e instanceof ApiError && e.status === 400 && e.body?.code === "validation_error" ? e.body.details : undefined;
      const lineAt = details?.length ? jsonLines(source) : undefined;
      setErrors(details?.length ? [...new Set(details.map(d => calmFormatError(lineAt!(d.field))))].map(message => ({ message })) : [{ message: e instanceof ApiError
        ? e.status === 400 ? calmFormatError() : e.status === 409 ? "Модель уже изменена на сервере. Скопируйте правки и откройте её заново."
          : STATUS_TEXT[e.status] ?? `Сервер вернул ошибку HTTP ${e.status}. Попробуйте ещё раз.`
        : "Сервер не ответил. Попробуйте ещё раз." }]);
    } finally { pending.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="model-editor" aria-labelledby="editor-title" onCancel={e => { e.preventDefault(); if (!pending.current) onCancel(); }}>
    <div className="editor-body">
      <h2 id="editor-title">Редактирование модели v{architecture.version}</h2>
      <p className="muted" id="editor-help">CALM 1.2 · до 16 МБ. Изменения применятся после сохранения и проверки сервером. Версия обновляется автоматически.</p>
      <textarea aria-label="JSON модели" aria-describedby="editor-help" autoFocus spellCheck={false} wrap="off" disabled={busy} value={source} onChange={e => { setSource(e.target.value); setErrors([]); }} />
      {errors.length > 0 && <section className="error-box" role="alert">{errors.map((error, i) => <p key={i}>{error.message}</p>)}</section>}
      <div className="actions">
        <button className="button" disabled={busy} onClick={() => { const model = parse(); if (model) setSource(JSON.stringify(model, null, 2)); }}>Форматировать JSON</button>
        <button className="button ghost" disabled={busy} onClick={onCancel}>Отменить</button>
        <button className="button primary" disabled={busy || source === initial} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить"}</button>
      </div>
    </div>
  </dialog>;
}
