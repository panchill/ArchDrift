import { useCallback, useEffect, useMemo, useState } from "react";
import { loadSnapshot } from "./api";
import { GraphCanvas, type Theme } from "./GraphCanvas";
import {
  buildGraph,
  edgeKey,
  nodeMeta,
  statusLabels,
  type DisplayEdge,
  type GraphView,
} from "./graph";
import type { Analysis, Edge, EdgeStatus, GraphNode } from "./types";
import "./styles.css";

const nodeLabels = {
  service: "Микросервис",
  endpoint: "HTTP endpoint",
  worker: "Воркер",
  postgres_database: "PostgreSQL",
  kafka_topic: "Kafka-топик",
};
// Jaeger UI of the OpenTelemetry Demo behind its frontend-proxy.
const JAEGER = "http://localhost:8080/jaeger/ui";
const POLL_MS = 5000;
const typeTags = {
  http_call: "HTTP",
  db_query: "PostgreSQL",
  publish: "publish · Kafka",
  consume: "consume · Kafka",
};
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
function EdgeDetails({
  edge,
  names,
}: {
  edge: DisplayEdge;
  names: Map<string, string>;
}) {
  return (
    <>
      <span className={`badge ${edge.status}`}>
        {statusLabels[edge.status]}
      </span>
      <h3>
        {names.get(edge.source)} <span className="arrow">→</span>{" "}
        {names.get(edge.target)}
      </h3>
      <p className="muted">
        {edge.type}
        {edge.dbOperation ? ` · ${edge.dbOperation}` : ""}
      </p>
      <dl className="metrics">
        <div>
          <dt>Операции</dt>
          <dd>{number.format(edge.observedOperations)}</dd>
        </div>
        <div>
          <dt>Ошибки</dt>
          <dd>{number.format(edge.errorOperations)}</dd>
        </div>
        <div>
          <dt>Среднее время</dt>
          <dd>{number.format(edge.avgDurationMs)} мс</dd>
        </div>
      </dl>
      <p className="small muted">
        Подсчитаны наблюдаемые спаны, а не весь трафик системы.
      </p>
      {edge.status === "indeterminate" && (
        <p className="notice">
          Не удалось определить точный endpoint или воркер. Для проверки
          декларации нужна более полная телеметрия.
        </p>
      )}
      <h4>Детальные связи · {edge.members.length}</h4>
      <ul className="member-list">
        {edge.members.map((member, i) => (
          <li key={i}>
            <span className={`status-dot ${member.status}`} />
            {statusLabels[member.status]}
            <small>
              {names.get(member.source)} → {names.get(member.target)}
            </small>
          </li>
        ))}
      </ul>
      <h4>Совпавшие CALM-связи</h4>
      <p className="mono small">
        {edge.matchedRelationshipIds.join(", ") || "Нет полного совпадения"}
      </p>
      <h4>Пример трейса</h4>
      <code className="trace-id">{edge.exampleTraceId}</code>
      <a
        className="button ghost"
        href={`${JAEGER}/trace/${edge.exampleTraceId}`}
        target="_blank"
        rel="noreferrer"
      >
        Трейс в Jaeger ↗
      </a>
    </>
  );
}
function NodeDetails({ item }: { item: GraphNode }) {
  return (
    <>
      <span className="eyebrow">{nodeLabels[item.node.type]}</span>
      <h3>{item.node.label}</h3>
      <p>{item.known ? "Объявлен в CALM" : "Нет точного объявления в CALM"}</p>
      <p className="muted">
        {item.observed
          ? "Наблюдался в выбранном интервале"
          : "В этом интервале не наблюдался"}
      </p>
      <h4>Канонический ID</h4>
      <code className="trace-id">{item.node.id}</code>
      {item.calmNodeId && (
        <>
          <h4>CALM ID</h4>
          <code>
            {item.calmNodeId}
            {item.calmInterfaceId ? ` / ${item.calmInterfaceId}` : ""}
          </code>
        </>
      )}
      {!item.known && (
        <p className="notice">
          Отсутствие узла в декларации само по себе не является нарушением.
          Проверяются наблюдаемые связи.
        </p>
      )}
    </>
  );
}

function DriftCard({
  edge,
  message,
  names,
  service,
  onShow,
}: {
  edge: Edge;
  message: string;
  names: Map<string, string>;
  service: (id: string) => string;
  onShow: () => void;
}) {
  const detailed = service(edge.source) !== names.get(edge.source);
  return (
    <article className={`drift-card ${edge.status}`}>
      <strong className="mono">
        {service(edge.source)} → {service(edge.target)}
      </strong>
      {detailed && (
        <small className="mono drift-route">
          {names.get(edge.source)} → {names.get(edge.target)}
        </small>
      )}
      <span className="op-tag">
        {edge.dbOperation
          ? `${edge.dbOperation} · PostgreSQL`
          : typeTags[edge.type]}
      </span>
      <p>{message}</p>
      <small className="muted">
        {number.format(edge.observedOperations)} операций · последняя{" "}
        {clock.format(new Date(edge.lastSeenAt))}
      </small>
      <div className="drift-actions">
        <button className="button primary" onClick={onShow}>
          Показать на схеме
        </button>
        <a
          className="button ghost"
          href={`${JAEGER}/trace/${edge.exampleTraceId}`}
          target="_blank"
          rel="noreferrer"
        >
          Трейс в Jaeger ↗
        </a>
      </div>
    </article>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<GraphView>("services");
  const [status, setStatus] = useState<EdgeStatus | "all">("all");
  const [onlyDrift, setOnlyDrift] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("dark");
  const onSelect = useCallback((id: string | null) => setSelected(id), []);
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      loadSnapshot(controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          setError("");
          // Same payload → same object, so the graph is not rebuilt every poll.
          setSnapshot((prev) =>
            JSON.stringify(prev) === JSON.stringify(data) ? prev : data,
          );
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : "Ошибка загрузки данных");
        });
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [attempt]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const graph = useMemo(() => {
    if (!snapshot) return { nodes: [], edges: [] };
    const full = buildGraph(snapshot, view, status);
    if (!onlyDrift) return full;
    const edges = full.edges.filter((e) => e.status !== "declared");
    const keep = new Set(edges.flatMap((e) => [e.source, e.target]));
    for (const { node } of full.nodes)
      if (keep.has(node.id) && "parentId" in node) keep.add(node.parentId);
    return { nodes: full.nodes.filter((n) => keep.has(n.node.id)), edges };
  }, [snapshot, view, status, onlyDrift]);
  const meta = useMemo(
    () => (snapshot ? nodeMeta(snapshot) : undefined),
    [snapshot],
  );
  const names = useMemo(
    () => new Map(snapshot?.nodes.map((n) => [n.node.id, n.node.label]) ?? []),
    [snapshot],
  );
  const service = useCallback(
    (id: string) => {
      const node = snapshot?.nodes.find((n) => n.node.id === id)?.node;
      return names.get(node && "parentId" in node ? node.parentId : id) ?? id;
    },
    [snapshot, names],
  );
  const edge = graph.edges.find((e) => e.id === selected);
  const node = graph.nodes.find((n) => n.node.id === selected);
  const edgesByKey = new Map(snapshot?.edges.map((e) => [edgeKey(e), e]));
  const unclear = snapshot?.edges.filter((e) => e.status === "indeterminate") ?? [];
  const violations =
    snapshot?.edges.filter((e) => e.status === "unexpected").length ?? 0;
  const show = (item: Pick<Edge, "source" | "target" | "type" | "dbOperation">) => {
    setView("details");
    setStatus("all");
    setOnlyDrift(false);
    setSelected(edgeKey(item));
  };
  const hasIncompleteTelemetry =
    snapshot &&
    (snapshot.diagnostics.unmatchedHttpClientSpans > 0 ||
      snapshot.diagnostics.unresolvedResourceSpans > 0 ||
      snapshot.diagnostics.serviceLevelOperations > 0);
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="./">
          <span className="brand-mark">a.</span>archdrift
        </a>
        <span className="brand-separator">/</span>
        <span className="project">Astronomy Shop</span>
        <div className="topbar-right">
          <button
            className="icon-button"
            aria-label="Обновить сейчас"
            title="Обновить сейчас"
            onClick={() => setAttempt((a) => a + 1)}
          >
            ↻
          </button>
          <button
            className="icon-button"
            aria-label="Переключить тему"
            title="Переключить тему"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "☾" : "☀"}
          </button>
        </div>
      </header>
      {error && !snapshot ? (
        <section className="error-state" role="alert">
          <h2>Не удалось загрузить граф</h2>
          <p>{error}</p>
          <button className="button" onClick={() => setAttempt((a) => a + 1)}>
            Повторить
          </button>
        </section>
      ) : !snapshot ? (
        <div className="loading" role="status">
          Загрузка архитектуры…
        </div>
      ) : (
        <div className="workspace">
          <section className="canvas-area">
            <GraphCanvas
              graph={graph}
              selected={selected}
              onSelect={onSelect}
              meta={meta}
              theme={theme}
            />
            <div className="float toolbar">
              <div className="segmented" aria-label="Детализация графа">
                <button
                  aria-pressed={view === "services"}
                  onClick={() => {
                    setView("services");
                    setSelected(null);
                  }}
                >
                  Сервисы
                </button>
                <button
                  aria-pressed={view === "details"}
                  onClick={() => {
                    setView("details");
                    setSelected(null);
                  }}
                >
                  Endpoints и воркеры
                </button>
              </div>
              <select
                aria-label="Статус связи"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as EdgeStatus | "all");
                  setSelected(null);
                }}
              >
                <option value="all">Все связи</option>
                {Object.entries(statusLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={onlyDrift}
                  onChange={(e) => {
                    setOnlyDrift(e.target.checked);
                    setSelected(null);
                  }}
                />
                <i />
                Только расхождения
              </label>
            </div>
            <div className="float counters" aria-label="Сводка анализа">
              <span className={violations ? "danger" : ""}>
                <strong>{violations}</strong> нарушения
              </span>
            </div>
            <div className="float legend" aria-label="Легенда графа">
              {Object.entries(statusLabels).map(([key, label]) => (
                <span key={key}>
                  <i className={`legend-line ${key}`} />
                  {label}
                </span>
              ))}
              <span>
                <i className="legend-box" />
                Нет в модели
              </span>
            </div>
          </section>
          <aside className="inspector" aria-label="Детали графа">
            <div className="inspector-body">
              {edge ? (
                <EdgeDetails edge={edge} names={names} />
              ) : node ? (
                <NodeDetails item={node} />
              ) : (
                <>
                  <h2 className="section-title">
                    Вне декларации <span className="count bad">{violations}</span>
                  </h2>
                  {snapshot.violations.map((v, i) => {
                    const item = {
                      source: v.source,
                      target: v.target,
                      type: v.edgeType,
                      dbOperation: v.dbOperation,
                    };
                    const match = edgesByKey.get(edgeKey(item));
                    return match ? (
                      <DriftCard
                        key={i}
                        edge={match}
                        message={v.message}
                        names={names}
                        service={service}
                        onShow={() => show(item)}
                      />
                    ) : null;
                  })}
                  {snapshot.edges.length === 0 && (
                    <p className="notice">
                      В этом интервале нет наблюдаемых связей.
                    </p>
                  )}
                  {snapshot.edges.length > 0 && violations === 0 && (
                    <p className="notice">Нарушений в наблюдаемых связях нет.</p>
                  )}
                  {unclear.length > 0 && (
                    <>
                      <h2 className="section-title">
                        Недостаточно данных{" "}
                        <span className="count warn">{unclear.length}</span>
                      </h2>
                      {unclear.map((e) => (
                        <DriftCard
                          key={edgeKey(e)}
                          edge={e}
                          message="Вызов виден только на уровне сервиса — нельзя проверить конкретный endpoint."
                          names={names}
                          service={service}
                          onShow={() => show(e)}
                        />
                      ))}
                    </>
                  )}
                  {hasIncompleteTelemetry && (
                    <details className="diagnostics">
                      <summary>Телеметрия неполная</summary>
                      <p>
                        HTTP-вызовы без определённого назначения:{" "}
                        {snapshot.diagnostics.unmatchedHttpClientSpans}.
                        Ресурсы без идентичности:{" "}
                        {snapshot.diagnostics.unresolvedResourceSpans}.
                        Операции без детализации:{" "}
                        {snapshot.diagnostics.serviceLevelOperations}.
                        Отсутствие нарушения не доказывает соответствие.
                      </p>
                    </details>
                  )}
                </>
              )}
              {(edge || node) && (
                <button className="back-button" onClick={() => setSelected(null)}>
                  ← К списку нарушений
                </button>
              )}
              <details className="accessible-list">
                <summary>Список связей и узлов — выбор с клавиатуры</summary>
                <h3>Связи</h3>
                {graph.edges.map((e) => (
                  <button key={e.id} onClick={() => setSelected(e.id)}>
                    <span className={`status-dot ${e.status}`} />
                    {names.get(e.source)} → {names.get(e.target)} ·{" "}
                    {e.dbOperation ?? e.type}
                    <small>{statusLabels[e.status]}</small>
                  </button>
                ))}
                <h3>Узлы</h3>
                {graph.nodes.map((n) => (
                  <button key={n.node.id} onClick={() => setSelected(n.node.id)}>
                    {n.node.label}
                    <small>{nodeLabels[n.node.type]}</small>
                  </button>
                ))}
              </details>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
