import { useEffect, useRef, useState } from "react";
import { ApiError, resetArchitecture, uploadArchitecture } from "./api";
import type { Analysis, Architecture } from "./types";
import { readModelFile, type Read } from "./upload";
import { resetFailure, STATUS_TEXT, translate } from "./serverErrors";
import { perMinute, plural, WORDS } from "./text";

function loadedAt(value: string) {
  const date = new Date(value), now = new Date(), yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const day = date.toDateString() === now.toDateString() ? "сегодня" : date.toDateString() === yesterday.toDateString() ? "вчера" : date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return `${day} в ${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}
function ResetDialog({ version, busy, error, onCancel, onConfirm, onDownload }: {
  version: number; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void; onDownload: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return <div className="dialog-backdrop"><div role="dialog" aria-modal="true" aria-labelledby="reset-title" className="dialog">
    <h2 id="reset-title">Сбросить модель v{version}?</h2>
    <p>Модель удалится с сервера. Схема и нарушения пропадут, пока не загрузите новую. Трейсы сохранятся.</p>
    <button type="button" className="text-link" onClick={onDownload}>Скачать JSON перед сбросом ↓</button>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions">
      <button ref={cancel} type="button" className="button ghost" onClick={onCancel}>Отмена</button>
      <button type="button" className="button danger" onClick={onConfirm} disabled={busy} aria-busy={busy}>{busy && <span className="spinner" aria-hidden="true" />}Сбросить</button>
    </div>
  </div></div>;
}
export function ModelTab({ architecture, snapshot, uploadedFile, onUploaded, onGraph, onReset }: {
  architecture: Architecture | null; snapshot: Analysis | null; uploadedFile?: string;
  onUploaded: (value: Architecture, name: string) => void; onGraph: () => void; onReset: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const resetPending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<Read | null>(null);
  const [failure, setFailure] = useState<{ title: string; rows: { place?: string; path?: string; message: string }[] } | null>(null);
  const [success, setSuccess] = useState(false);
  const [withoutTraffic, setWithoutTraffic] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  async function upload(candidate?: File) {
    if (!candidate || pending.current) return;
    pending.current = true; setBusy(true); setFailure(null); setSuccess(false); setOver(false);
    try {
      const read = await readModelFile(candidate); setFile(read);
      if (!read.ok) { setFailure({ title: "Файл не загружен", rows: [{ message: read.error }] }); return; }
      try {
        const value = await uploadArchitecture(read.model, architecture?.version ?? 0);
        onUploaded(value, read.name); setSuccess(true); setFile(null);
      } catch (e) {
        const details = e instanceof ApiError && e.status === 400 && e.body?.code === "validation_error" ? e.body.details : undefined;
        setFailure(details?.length ? {
          title: `Сервер не принял модель — ${plural(details.length, WORDS.errors)}`, rows: translate(details, read.model),
        } : { title: "Сервер не принял модель", rows: [{ message: e instanceof ApiError ? STATUS_TEXT[e.status] ?? `Сервер вернул ошибку HTTP ${e.status}. Попробуйте ещё раз.` : "Сервер не ответил. Попробуйте ещё раз." }] });
      }
    } finally { pending.current = false; setBusy(false); }
  }
  function download() {
    if (!architecture) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(architecture.model, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `architecture-v${architecture.version}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function reset() {
    if (!architecture || resetPending.current) return;
    resetPending.current = true; setResetBusy(true); setResetError("");
    try {
      await resetArchitecture(architecture.version);
      setConfirmReset(false); setResetBusy(false); resetPending.current = false; onReset();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { setConfirmReset(false); setResetBusy(false); resetPending.current = false; onReset(); return; }
      setResetError(resetFailure(e)); setResetBusy(false); resetPending.current = false;
    }
  }
  const closeReset = () => { if (!resetBusy) { setConfirmReset(false); setResetError(""); } };
  const model = architecture?.model;
  const names = new Map(model?.nodes.map(n => [n["unique-id"], n.name]));
  const types = new Map(model?.nodes.map(n => [n["unique-id"], n["node-type"]]));
  const relations = (model?.relationships ?? []).filter(r => r["relationship-type"].connects).map(r => {
    const pair = r["relationship-type"].connects!;
    const matches = (snapshot?.edges ?? []).filter(e => e.matchedRelationshipIds.includes(r["unique-id"]));
    const type = r.metadata?.archdrift?.type;
    const target = types.get(pair.destination.node);
    const protocol = type === "db_query" || (!type && target === "database") ? "PostgreSQL" : type === "publish" || type === "consume" || (!type && (target === "kafka-topic" || types.get(pair.source.node) === "kafka-topic")) ? "Kafka" : "HTTP";
    return { id: r["unique-id"], source: names.get(pair.source.node) ?? pair.source.node, target: names.get(pair.destination.node) ?? pair.destination.node, visible: matches.length > 0, ops: matches.reduce((n, e) => n + e.observedOperations, 0), protocol };
  }).sort((a, b) => Number(a.visible) - Number(b.visible) || a.source.localeCompare(b.source));
  const visible = relations.filter(r => r.visible).length;
  const services = model?.nodes.filter(n => n["node-type"] === "service") ?? [];
  const stats = [plural(services.length, WORDS.services), plural(services.reduce((n, s) => n + (s.interfaces?.length ?? 0), 0), WORDS.endpoints), plural(model?.nodes.filter(n => n["node-type"] === "database").length ?? 0, WORDS.dbs), plural(model?.nodes.filter(n => n["node-type"] === "kafka-topic").length ?? 0, WORDS.topics), plural(relations.length, WORDS.links)];
  return <main className={`page ${architecture ? "page-wide" : "page-narrow"}`} onDragOver={e => e.preventDefault()} onDrop={e => e.preventDefault()}>
    <input ref={input} type="file" accept=".json,application/json" aria-label="Файл CALM" hidden disabled={busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
    <div className="page-heading">
      <div><h1>{architecture ? `Модель v${architecture.version}` : "Загрузите модель архитектуры"}</h1>
        <p className="muted">{architecture ? `Загружена ${loadedAt(architecture.updatedAt)}${uploadedFile ? ` из ${uploadedFile}` : ""}` : "ArchDrift сравнивает CALM-модель с тем, что видно в трейсах. Схема появится, как только будет модель."}</p></div>
      {architecture && <div className="actions"><button className="button ghost" onClick={download}>Скачать JSON</button><button className="button danger" onClick={() => { setResetError(""); setConfirmReset(true); }}>Сбросить модель</button><button className="button primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Загружаем…" : "Загрузить новую версию"}</button></div>}
    </div>
    {!architecture && !failure && <button className={`dropzone ${over ? "over" : ""}`} onDragOver={e => { e.preventDefault(); if (!busy) setOver(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files[0]); }} disabled={busy} onClick={() => input.current?.click()}><span className="upload-icon">↑</span><strong>{busy ? "Загружаем…" : "Перетащите architecture.json сюда"}</strong><span>или <u>выберите файл</u> · CALM 1.2, до 16 МБ</span></button>}
    {failure && <>
      {file && <div className="file-chip">▤ <strong>{file.name}</strong><span className="muted">{new Intl.NumberFormat("ru-RU").format(Math.max(1, Math.round(file.size / 1024)))} КБ</span></div>}
      <section className="error-box" role="alert"><h2>● {failure.title}</h2>{failure.rows.map((row, i) => <div className={`row ${row.place ? "" : "single"}`} key={i}>{row.place && <div><strong>{row.place}</strong><small className="mono">{row.path}</small></div>}<p>{row.message}</p></div>)}</section>
      <button className="button primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Загружаем…" : "Выбрать другой файл"}</button>
    </>}
    {success && <div className="ok-box" role="status">● Модель загружена. Сравнение с трейсами уже идёт. <button className="button ghost" onClick={onGraph}>Открыть схему</button></div>}
    {confirmReset && architecture && <ResetDialog version={architecture.version} busy={resetBusy} error={resetError} onCancel={closeReset} onConfirm={() => { void reset(); }} onDownload={download} />}
    {architecture && <>
      <div className="stats">{stats.map((s, i) => <div key={i}><strong>{s.split(" ")[0]}</strong><span>{s.slice(s.indexOf(" ") + 1)}</span></div>)}</div>
      <section className="table-wrap"><div className="table-heading"><strong>Связи модели</strong><span className="muted">{visible} из {relations.length} видны в трейсах</span><progress max={relations.length || 1} value={visible} aria-label="Связи, видимые в трейсах" /><div className="segmented"><button aria-pressed={!withoutTraffic} onClick={() => setWithoutTraffic(false)}>Все</button><button aria-pressed={withoutTraffic} onClick={() => setWithoutTraffic(true)}>Без трафика {relations.length - visible}</button></div></div>
        <table className="table"><thead><tr>{["Откуда", "Куда", "Протокол", "В трейсах", "Частота"].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{relations.filter(r => !withoutTraffic || !r.visible).map(r => <tr key={r.id}><td className="mono">{r.source}</td><td className="mono">{r.target}</td><td>{r.protocol}</td><td className={r.visible ? "ok" : "muted"}>● {r.visible ? "Видна" : "Нет трафика"}</td><td>{r.visible && snapshot ? `${perMinute(r.ops, snapshot)}/мин` : "—"}</td></tr>)}</tbody></table>
      </section>
    </>}
  </main>;
}
