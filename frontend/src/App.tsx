import { useCallback, useEffect, useMemo, useState } from "react";
import { loadSnapshot } from "./api";
import { GraphCanvas } from "./GraphCanvas";
import {
  buildGraph,
  statusLabels,
  type DisplayEdge,
  type GraphView,
} from "./graph";
import type { EdgeStatus, GraphNode, Snapshot } from "./types";
import "./styles.css";

const nodeLabels = {
  service: "Микросервис",
  endpoint: "HTTP endpoint",
  worker: "Воркер",
  postgres_database: "PostgreSQL",
  kafka_topic: "Kafka-топик",
};
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const time = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
});
const date = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
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
      <p className="small muted">
        Идентификаторы в демо синтетические; трейсы не загружаются.
      </p>
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

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<GraphView>("services");
  const [status, setStatus] = useState<EdgeStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const onSelect = useCallback((id: string) => setSelected(id), []);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setSnapshot(null);
    loadSnapshot(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSnapshot(data);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Ошибка загрузки данных");
      });
    return () => controller.abort();
  }, [attempt]);
  const graph = useMemo(
    () =>
      snapshot
        ? buildGraph(snapshot.analysis, view, status, query)
        : { nodes: [], edges: [] },
    [snapshot, view, status, query],
  );
  const names = useMemo(
    () =>
      new Map(
        snapshot?.analysis.nodes.map((n) => [n.node.id, n.node.label]) ?? [],
      ),
    [snapshot],
  );
  const edge = graph.edges.find((e) => e.id === selected);
  const node = graph.nodes.find((n) => n.node.id === selected);
  const violations =
    snapshot?.analysis.edges.filter((e) => e.status === "unexpected").length ??
    0;
  const hasIncompleteTelemetry =
    snapshot &&
    (snapshot.analysis.diagnostics.unmatchedHttpClientSpans > 0 ||
      snapshot.analysis.diagnostics.unresolvedResourceSpans > 0 ||
      snapshot.analysis.diagnostics.serviceLevelOperations > 0);
  const startDate = snapshot
    ? date.format(new Date(snapshot.analysis.from))
    : "";
  const endDate = snapshot ? date.format(new Date(snapshot.analysis.to)) : "";
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="./">
          <span className="brand-mark">a.</span>archdrift
          <span className="brand-separator">/</span>
          <span className="project">Astronomy Shop</span>
        </a>
        <span className="demo-label">
          <span /> МОК · CALM 1.2
        </span>
      </header>
      <main>
        <div className="page-heading">
          <h1>
            Архитектура <span className="heading-divider">/</span>{" "}
            <span>Astronomy Shop</span>
          </h1>
          <button
            className="button"
            onClick={() => {
              setSelected(null);
              setAttempt((a) => a + 1);
            }}
          >
            ↻ Обновить мок
          </button>
        </div>
        {error ? (
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
          <>
            <section className="summary" aria-label="Сводка анализа">
              <div className="summary-counts">
                <span>
                  <strong>
                    {
                      snapshot.analysis.nodes.filter(
                        (n) => n.node.type === "service",
                      ).length
                    }
                  </strong>{" "}
                  сервисов
                </span>
                <span>
                  <strong>{snapshot.analysis.edges.length}</strong> связей
                </span>
                <span className={violations ? "summary-warning" : ""}>
                  <strong>{violations}</strong> нарушения
                </span>
              </div>
              <div className="snapshot-time">
                <span>
                  {time.format(new Date(snapshot.analysis.from))} —{" "}
                  {time.format(new Date(snapshot.analysis.to))} UTC
                </span>
                <span>
                  {startDate}
                  {startDate !== endDate ? ` — ${endDate}` : ""}
                </span>
                <span className="snapshot-label">Фиксированный снимок</span>
              </div>
            </section>
            <section className="graph-panel">
              <div className="toolbar">
                <div className="view-toggle" aria-label="Детализация графа">
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
                <div className="graph-filters">
                  <input
                    aria-label="Поиск узла"
                    placeholder="Найти сервис, endpoint, топик"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSelected(null);
                    }}
                  />
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
                </div>
              </div>
              <div className="graph-layout">
                <div className="graph-area">
                  <GraphCanvas
                    graph={graph}
                    selected={selected}
                    onSelect={onSelect}
                  />
                  <div className="graph-caption">
                    <span>
                      {graph.nodes.length} узлов · {graph.edges.length} связей в
                      представлении
                    </span>
                    <span>Архитектура v{snapshot.architecture.version}</span>
                  </div>
                  <div className="graph-legend" aria-label="Легенда графа">
                    {Object.entries(statusLabels).map(([key, label]) => (
                      <span key={key}>
                        <i className={`legend-line ${key}`} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
                <aside className="inspector" aria-label="Детали графа">
                  {edge ? (
                    <EdgeDetails edge={edge} names={names} />
                  ) : node ? (
                    <NodeDetails item={node} />
                  ) : (
                    <>
                      <div className="panel-heading">
                        <h2>Вне декларации</h2>
                        <span className="count">{violations}</span>
                      </div>
                      <p className="muted">
                        Выберите связь, чтобы посмотреть операции и причину
                        отклонения.
                      </p>
                      <div className="violation-list">
                        {snapshot.analysis.violations.map((v, i) => (
                          <button
                            className="violation-card"
                            key={i}
                            onClick={() => {
                              setView("details");
                              setStatus("all");
                              setQuery("");
                              setSelected(
                                JSON.stringify([
                                  v.source,
                                  v.target,
                                  v.edgeType,
                                  v.dbOperation ?? null,
                                ]),
                              );
                            }}
                          >
                            <span className="violation-type">
                              {v.dbOperation ?? v.edgeType}
                              <span aria-hidden="true">↗</span>
                            </span>
                            <strong>
                              {names.get(v.source)}{" "}
                              <span className="arrow">→</span>{" "}
                              {names.get(v.target)}
                            </strong>
                            <small>{v.message}</small>
                          </button>
                        ))}
                      </div>
                      {snapshot.analysis.edges.length === 0 && (
                        <p className="notice">
                          В этом интервале нет наблюдаемых связей.
                        </p>
                      )}
                      {snapshot.analysis.edges.length > 0 &&
                        violations === 0 && (
                          <p className="notice">
                            Нарушений в наблюдаемых связях нет.
                          </p>
                        )}
                      {hasIncompleteTelemetry && (
                        <details className="diagnostics">
                          <summary>Телеметрия неполная</summary>
                          <p>
                            HTTP-вызовы без определённого назначения:{" "}
                            {
                              snapshot.analysis.diagnostics
                                .unmatchedHttpClientSpans
                            }
                            . Ресурсы без идентичности:{" "}
                            {
                              snapshot.analysis.diagnostics
                                .unresolvedResourceSpans
                            }
                            . Операции без детализации:{" "}
                            {
                              snapshot.analysis.diagnostics
                                .serviceLevelOperations
                            }
                            . Отсутствие нарушения не доказывает соответствие.
                          </p>
                        </details>
                      )}
                      <div className="inspector-help">
                        <h4>На схеме</h4>
                        <p>
                          <span className="node-key service-key" />
                          Сервис и его endpoints
                        </p>
                        <p>
                          <span className="node-key database-key" />
                          PostgreSQL
                        </p>
                        <p>
                          <span className="node-key topic-key" />
                          Kafka-топик
                        </p>
                        <small>
                          Пунктирная рамка — воркер или неизвестный узел.
                          Неактивные узлы не наблюдались в этом интервале.
                        </small>
                      </div>
                    </>
                  )}
                  {(edge || node) && (
                    <button
                      className="back-button"
                      onClick={() => setSelected(null)}
                    >
                      ← К списку нарушений
                    </button>
                  )}
                </aside>
              </div>
            </section>
            <details className="accessible-list">
              <summary>Список связей и узлов — выбор с клавиатуры</summary>
              <div className="list-grid">
                <div>
                  <h3>Связи</h3>
                  {graph.edges.map((e) => (
                    <button key={e.id} onClick={() => setSelected(e.id)}>
                      <span className={`status-dot ${e.status}`} />
                      {names.get(e.source)} → {names.get(e.target)} ·{" "}
                      {e.dbOperation ?? e.type}
                      <small>{statusLabels[e.status]}</small>
                    </button>
                  ))}
                </div>
                <div>
                  <h3>Узлы</h3>
                  {graph.nodes.map((n) => (
                    <button
                      key={n.node.id}
                      onClick={() => setSelected(n.node.id)}
                    >
                      {n.node.label}
                      <small>{nodeLabels[n.node.type]}</small>
                    </button>
                  ))}
                </div>
              </div>
            </details>
            <footer className="page-footer">
              <span>CALM 1.2 / OpenTelemetry · Демонстрационные данные</span>
              <div>
                <a
                  href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(snapshot.architecture.model, null, 2))}`}
                  download="architecture.json"
                >
                  CALM JSON ↓
                </a>
                <a
                  href={`${import.meta.env.BASE_URL}mocks/analysis.json`}
                  download
                >
                  Анализ JSON ↓
                </a>
              </div>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
