import { useEffect, useRef, useState } from "react";
import { ApiError, JAEGER, uploadArchitecture } from "./api";
import { calmPatch } from "./calmSnippet";
import { buildGraph, ownerId, serviceName, statusLabels, type DisplayEdge, type NodeMeta } from "./graph";
import { callName, clockShort, formatRate, perMinute, reason, shortRoute, trimRoute } from "./text";
import type { Analysis, Architecture, CalmRelationship, Edge, GraphNode } from "./types";
import type { Direction } from "./GraphCanvas";

function EdgePanel({ edge, nodes, architecture, snapshot, onModelSaved }: { edge: DisplayEdge; nodes: Map<string, GraphNode>; architecture: Architecture; snapshot: Analysis; onModelSaved: (value: Architecture) => void }) {
  const own = edge.status === "declared" ? edge.members : edge.members.filter(e => e.status === edge.status);
  const members = own.length ? own : [edge];
  const member = members[0];
  const ops = edge.status === "unexpected" ? members.reduce((n, e) => n + e.observedOperations, 0) : edge.observedOperations;
  const a = serviceName(member.source, nodes), b = serviceName(member.target, nodes);
  const source = nodes.get(member.source)?.node;
  const calls = [...new Set(members.map(m => callName(m, nodes)))];
  const firstSeen = members.reduce((t, m) => m.firstSeenAt < t ? m.firstSeenAt : t, member.firstSeenAt);
  const relations = edge.matchedRelationshipIds.map(id => ({ id, text: architecture.model.relationships.find(r => r["unique-id"] === id)?.description as string | undefined ?? id }));
  const patch = edge.status === "unexpected" ? calmPatch(member, nodes, architecture.model.relationships.map(r => r["unique-id"])) : undefined;
  const trace = `${JAEGER}/trace/${member.exampleTraceId}`;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const pending = useRef(false);
  const [adding, setAdding] = useState(false), [addError, setAddError] = useState("");
  const stale = architecture.version !== snapshot.architectureVersion;
  useEffect(() => { setAddError(""); }, [member.source, member.target, member.type]);
  async function addRelationship() {
    if (pending.current || stale || !patch || patch.missing.length > 0) return;
    pending.current = true; setAdding(true); setAddError("");
    try {
      const relationship = JSON.parse(patch.text) as CalmRelationship;
      const model = { ...architecture.model, relationships: [...architecture.model.relationships, relationship] };
      onModelSaved(await uploadArchitecture(model, architecture.version, false));
    } catch (e) {
      setAddError(e instanceof ApiError && e.status === 409
        ? "Модель изменилась. Дождитесь обновления и повторите."
        : e instanceof ApiError && e.status === 400 ? "Сервер отклонил связь. Проверьте модель."
        : "Не удалось добавить связь. Попробуйте ещё раз.");
    } finally { pending.current = false; setAdding(false); }
  }
  useEffect(() => { if (copied) { const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); } }, [copied]);
  const call = (text: string) => { const [method, route] = text.includes(" /") ? [text.slice(0, text.indexOf(" ")), text.slice(text.indexOf(" ") + 1)] : ["", text]; return <span title={text}>{method && `${method} `}{trimRoute(route)}</span>; };
  return <>
    <span className={`badge ${edge.status}`}>{statusLabels[edge.status]}</span><h3>{a} <span className="arrow">→</span> {b}</h3>
    {edge.status === "indeterminate" && <p className="muted">{reason(member, nodes)}</p>}
    <div className="flow">
      <p><strong>{a}</strong>{source?.type === "endpoint" && <span className="mono muted" title={source.route}> {trimRoute(shortRoute(source.route))}</span>}</p>
      <p className="flow-arrow" aria-hidden="true">↓</p>
      <p><strong>{b}</strong></p>
      <ul className="flow-calls mono">{calls.slice(0, 3).map(c => <li key={c}>{call(c)}</li>)}{calls.length > 3 && <li className="muted">+ ещё {calls.length - 3}</li>}</ul>
    </div>
    <p className="meta-line">{perMinute(ops, snapshot)} в мин · {edge.status === "declared"
      ? <>в модели: <span title={relations.map(r => r.id).join(", ")}>«{relations[0]?.text ?? "связь"}»{relations.length > 1 ? ` и ещё ${relations.length - 1}` : ""}</span></>
      : <>впервые в {clockShort(firstSeen)}{Date.parse(firstSeen) > Date.parse(architecture.updatedAt) ? `, после v${architecture.version}` : ""}</>}</p>
    <a className="button primary" href={trace} target="_blank" rel="noreferrer">Открыть трейс ↗</a>
    {patch && <section className="snippet-section">
      <strong>Вызов нужен?</strong>
      {patch.missing.map(m => <p key={m.label} className="muted">{m.kind} {m.label} нет в модели.</p>)}
      <div className="snippet-actions">
        {!patch.missing.length && <button className="button primary" disabled={adding || stale} onClick={() => void addRelationship()}>{adding ? "Добавляем…" : stale ? "Обновляем анализ…" : "Добавить в модель"}</button>}
        <button className="button" onClick={async () => {
          try { await navigator.clipboard.writeText(patch.text); setCopied(true); setCopyError(false); } catch { setCopyError(true); }
        }}>{copied ? "Скопировано" : patch.missing.length ? "Скопировать сервис и связь" : "Скопировать связь"}</button>
        <button className="button ghost" aria-expanded={showJson} onClick={() => setShowJson(v => !v)}>{showJson ? "Скрыть JSON" : "Показать JSON"}</button>
      </div>
      {showJson && <pre className="snippet">{patch.text}</pre>}
      {addError && <p role="alert">{addError}</p>}
      {copyError && <p role="alert">Не удалось скопировать. Откройте JSON и скопируйте вручную.</p>}
    </section>}
  </>;
}
const nodeLabels = { service: "Сервис", endpoint: "Endpoint", worker: "Воркер", postgres_database: "PostgreSQL", kafka_topic: "Kafka-топик" };
function NodePanel({ item, snapshot, nodes, meta, direction, setDirection, expanded, onExpand, onShow }: {
  item: GraphNode; snapshot: Analysis; nodes: Map<string, GraphNode>; meta?: NodeMeta;
  direction: Direction; setDirection: (v: Direction) => void; expanded: string | null; onExpand: (id: string) => void; onShow: (e: Edge) => void;
}) {
  const n = item.node, member = "parentId" in n;
  const inside = (id: string) => id === n.id || (!member && ownerId(id, nodes) === n.id);
  const outgoing = snapshot.edges.filter(e => inside(e.source) && !inside(e.target));
  const incoming = snapshot.edges.filter(e => inside(e.target) && !inside(e.source));
  const count = (edges: Edge[], side: "source" | "target") => new Set(edges.map(e => ownerId(e[side], nodes))).size;
  const list = member ? [...incoming, ...outgoing] : n.type === "postgres_database" || direction === "in" ? incoming : outgoing;
  const aggregate = buildGraph({ ...snapshot, edges: list }, "services").edges;
  const groups = new Map<string, DisplayEdge[]>();
  for (const edge of aggregate) {
    const peer = edge.source === ownerId(n.id, nodes) ? edge.target : edge.source;
    groups.set(peer, [...(groups.get(peer) ?? []), edge]);
  }
  const priority = { unexpected: 0, indeterminate: 1, declared: 2 };
  const peers = [...groups].map(([id, edges]) => {
    edges.sort((a, b) => priority[a.status] - priority[b.status] || b.observedOperations - a.observedOperations);
    const routes = [...new Set(edges.flatMap(e => e.members.flatMap(m => {
      if (m.type === "publish" || m.type === "consume") return [`Kafka · ${m.type}`];
      if (m.type === "db_query") return [m.dbOperation ?? "OTHER"];
      const end = nodes.get(m.target)?.node;
      return [end?.type === "endpoint" ? shortRoute(end.route) : "без маршрута"];
    })))];
    return { id, edge: edges[0], ops: edges.reduce((v, e) => v + e.observedOperations, 0), routes };
  }).sort((a, b) => priority[a.edge.status] - priority[b.edge.status] || b.ops - a.ops);
  const hasChildren = snapshot.nodes.some(({ node }) => "parentId" in node && node.parentId === n.id);
  return <>
    <span className="eyebrow">{nodeLabels[n.type]}</span><h3>{n.type === "endpoint" ? `${n.method} ${shortRoute(n.route)}` : n.label}</h3>
    {member ? <p className="muted">в сервисе {serviceName(n.id, nodes)}</p> : n.type === "service" && <p className="muted">{meta?.caption} · {formatRate(meta?.opsPerMinute ?? 0)} опер/мин · <span className={!item.known ? "unexpected" : ""}>{item.known ? "есть в модели" : "нет в модели"}</span></p>}
    {!member && <div className="subtabs" role="tablist" aria-label="Направление вызовов">
      {n.type === "postgres_database" ? <button role="tab" aria-selected>Кто обращается · {count(incoming, "source")}</button> : ((n.type === "kafka_topic" ? ["in", "out"] : ["out", "in"]) as Direction[]).map(side => <button key={side} role="tab" aria-selected={direction === side} onClick={() => setDirection(side)}>{side === "in" ? (n.type === "kafka_topic" ? "Кто пишет" : "Кто вызывает") : (n.type === "kafka_topic" ? "Кто читает" : "Куда ходит")} · {side === "in" ? count(incoming, "source") : count(outgoing, "target")}</button>)}
    </div>}
    <ul className="peer-list">{peers.map(p => <li key={p.id}><button onClick={() => onShow(p.edge.members[0])}><span className={`status-dot ${p.edge.status}`} /><span className="peer-name">{serviceName(p.id, nodes)}<small className="mono">{p.routes.slice(0, 2).join(", ")}{p.routes.length > 2 ? ` и ещё ${p.routes.length - 2}` : ""}</small></span><span className="nowrap">{perMinute(p.ops, snapshot)}/мин</span></button></li>)}</ul>
    {!peers.length && <p className="muted">Наблюдаемых связей нет.</p>}
    {n.type === "service" && hasChildren && <button className="button" onClick={() => onExpand(n.id)}>{expanded === n.id ? "Свернуть endpoints" : "Раскрыть endpoints на схеме"}</button>}
  </>;
}
export function Inspector(props: {
  edge?: DisplayEdge; item?: GraphNode; architecture: Architecture; snapshot: Analysis; nodes: Map<string, GraphNode>;
  meta?: NodeMeta; direction: Direction; setDirection: (v: Direction) => void; expanded: string | null;
  onExpand: (id: string) => void; onShow: (e: Edge) => void; onClose: () => void;
  onModelSaved: (value: Architecture) => void;
}) {
  return <aside className="inspector" aria-label="Детали графа"><button className="close" aria-label="Закрыть панель" onClick={props.onClose}>×</button><div className="inspector-body">
    {props.edge ? <EdgePanel key={props.edge.id} edge={props.edge} nodes={props.nodes} architecture={props.architecture} snapshot={props.snapshot} onModelSaved={props.onModelSaved} /> : props.item ? <NodePanel {...props} item={props.item} /> : null}
  </div></aside>;
}
