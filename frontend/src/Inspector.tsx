import { useEffect, useState } from "react";
import { JAEGER } from "./api";
import { calmSnippet } from "./calmSnippet";
import { buildGraph, ownerId, serviceName, statusLabels, type DisplayEdge, type NodeMeta } from "./graph";
import { callName, clockTime, perMinute, reason, shortRoute } from "./text";
import type { Analysis, Architecture, Edge, GraphNode } from "./types";
import type { Direction } from "./GraphCanvas";

function EdgePanel({ edge, nodes, architecture, snapshot }: { edge: DisplayEdge; nodes: Map<string, GraphNode>; architecture: Architecture; snapshot: Analysis }) {
  const member = edge.members.find(e => e.status === edge.status) ?? edge;
  const ops = edge.status === "unexpected" ? edge.members.filter(e => e.status === "unexpected").reduce((n, e) => n + e.observedOperations, 0) : edge.observedOperations;
  const a = serviceName(member.source, nodes), b = serviceName(member.target, nodes);
  const phrase = member.type === "db_query" ? `${a} обращается к базе ${b}` : member.type === "publish" ? `${a} пишет в топик ${b}` : member.type === "consume" ? `${b} читает топик ${a}` : `${a} вызывает ${b}`;
  const source = nodes.get(member.source)?.node;
  const snippet = calmSnippet(member, nodes);
  const trace = `${JAEGER}/trace/${member.exampleTraceId}`;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => { if (copied) { const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); } }, [copied]);
  return <>
    <span className={`eyebrow ${edge.status}`}>{statusLabels[edge.status]}</span><h3>{a} <span className="arrow">→</span> {b}</h3>
    {edge.status === "unexpected" && <p className="muted">{phrase}, но в модели v{architecture.version} такой связи нет. Либо модель устарела, либо вызов лишний.</p>}
    {edge.status === "indeterminate" && <p className="muted">{reason(member, nodes)}</p>}
    <dl className="facts">
      <dt>Вызов</dt><dd className="mono">{callName(member, nodes)}</dd>
      {edge.status === "unexpected" && source?.type === "endpoint" && <><dt>Откуда</dt><dd className="mono">{shortRoute(source.route)}</dd></>}
      <dt>Частота</dt><dd>{perMinute(ops, snapshot)} в минуту</dd>
      {edge.status !== "declared" && <><dt>Впервые</dt><dd>{clockTime(member.firstSeenAt)}{Date.parse(member.firstSeenAt) > Date.parse(architecture.updatedAt) ? `, после загрузки v${architecture.version}` : ""}</dd></>}
      <dt>Пример</dt><dd className="mono"><a href={trace} target="_blank" rel="noreferrer">{member.exampleTraceId.slice(0, 12)}… ↗</a></dd>
      {edge.status === "declared" && <><dt>Связь в модели</dt><dd className="mono">{edge.matchedRelationshipIds.map(id => <div key={id}>{id}</div>)}</dd></>}
    </dl>
    <a className="button primary" href={trace} target="_blank" rel="noreferrer">Открыть трейс в Jaeger ↗</a>
    {edge.status === "unexpected" && <section className="snippet-section"><div className="snippet-heading"><strong>Если вызов нужен — добавьте в модель</strong>{typeof snippet === "string" && <button className="button ghost" onClick={async () => {
      try { await navigator.clipboard.writeText(snippet); setCopied(true); setCopyError(false); } catch { setCopyError(true); }
    }}>{copied ? "Скопировано" : "Копировать"}</button>}</div>
      {typeof snippet === "string" ? <pre className="snippet">{snippet}</pre> : <p className="muted">Узла {snippet.missing} нет в модели — сначала добавьте его.</p>}
      {copyError && <p role="alert">Не удалось скопировать. Выделите текст и скопируйте вручную.</p>}
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
    {member ? <p className="muted">в сервисе {serviceName(n.id, nodes)}</p> : n.type === "service" && <p className="muted">{meta?.caption} · {Math.round(meta?.opsPerMinute ?? 0)} опер/мин · <span className={!item.known ? "unexpected" : ""}>{item.known ? "есть в модели" : "нет в модели"}</span></p>}
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
}) {
  return <aside className="inspector" aria-label="Детали графа"><button className="close" aria-label="Закрыть панель" onClick={props.onClose}>×</button><div className="inspector-body">
    {props.edge ? <EdgePanel key={props.edge.id} edge={props.edge} nodes={props.nodes} architecture={props.architecture} snapshot={props.snapshot} /> : props.item ? <NodePanel {...props} item={props.item} /> : null}
  </div></aside>;
}
