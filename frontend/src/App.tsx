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
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
function EdgeDetails({
  edge,
  names,
  message,
}: {
  edge: DisplayEdge;
  names: Map<string, string>;
  message?: string;
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
      {message && <p>{message}</p>}
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

function DriftRow({
  edge,
  service,
  onShow,
}: {
  edge: Edge;
  service: (id: string) => string;
  onShow: () => void;
}) {
  return (
    <li className="drift-row">
      <button onClick={onShow}>
        <span className={`status-dot ${edge.status}`} />
        <span className="drift-path">
          {service(edge.source)} → {service(edge.target)}
          {edge.dbOperation && <span className="muted"> · {edge.dbOperation}</span>}
        </span>
        <span className="drift-count mono">
          {number.format(edge.observedOperations)}
        </span>
      </button>
      <a
        href={`${JAEGER}/trace/${edge.exampleTraceId}`}
        target="_blank"
        rel="noreferrer"
      >
        трейс ↗
      </a>
    </li>
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
  const [panelOpen, setPanelOpen] = useState(false);
  const onSelect = useCallback((id: string | null) => {
    setSelected(id);
    if (id) setPanelOpen(true);
  }, []);
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
    setPanelOpen(true);
  };
  const message =
    edge &&
    snapshot?.violations.find((v) =>
      edge.members.some(
        (m) =>
          edgeKey(m) ===
          edgeKey({
            source: v.source,
            target: v.target,
            type: v.edgeType,
            dbOperation: v.dbOperation,
          }),
      ),
    )?.message;
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
        <div className={`workspace ${panelOpen ? "" : "panel-closed"}`}>
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
              <button
                className={violations ? "danger" : ""}
                onClick={() => setPanelOpen(true)}
              >
                <strong>{violations}</strong> нарушения
              </button>
            </div>
            <button
              className="panel-toggle"
              aria-expanded={panelOpen}
              aria-controls="inspector"
              aria-label={panelOpen ? "Скрыть панель" : "Показать панель"}
              title={panelOpen ? "Скрыть панель" : "Показать панель"}
              onClick={() => setPanelOpen((o) => !o)}
            >
              {panelOpen ? "›" : "‹"}
            </button>
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
          <aside
            id="inspector"
            className="inspector"
            aria-label="Детали графа"
            hidden={!panelOpen}
          >
            <div className="inspector-body">
              {edge ? (
                <EdgeDetails edge={edge} names={names} message={message} />
              ) : node ? (
                <NodeDetails item={node} />
              ) : (
                <>
                  <h2 className="section-title">
                    Расхождения <span className="muted">{violations}</span>
                  </h2>
                  {violations > 0 && (
                    <p className="section-note">Этих вызовов нет в модели CALM</p>
                  )}
                  <ul className="drift-list">
                    {snapshot.violations.map((v, i) => {
                      const item = {
                        source: v.source,
                        target: v.target,
                        type: v.edgeType,
                        dbOperation: v.dbOperation,
                      };
                      const match = edgesByKey.get(edgeKey(item));
                      return match ? (
                        <DriftRow
                          key={i}
                          edge={match}
                          service={service}
                          onShow={() => show(item)}
                        />
                      ) : null;
                    })}
                  </ul>
                  {snapshot.edges.length === 0 && (
                    <p className="section-note">
                      В этом интервале нет наблюдаемых связей.
                    </p>
                  )}
                  {snapshot.edges.length > 0 && violations === 0 && (
                    <p className="section-note">Нарушений в наблюдаемых связях нет.</p>
                  )}
                  {unclear.length > 0 && (
                    <>
                      <h2 className="section-title">
                        Недостаточно данных{" "}
                        <span className="muted">{unclear.length}</span>
                      </h2>
                      <p className="section-note">
                        Виден только сервис, без endpoint — проверить нельзя
                      </p>
                      <ul className="drift-list">
                        {unclear.map((e) => (
                          <DriftRow
                            key={edgeKey(e)}
                            edge={e}
                            service={service}
                            onShow={() => show(e)}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
              {(edge || node) && (
                <button className="back-button" onClick={() => setSelected(null)}>
                  ← К списку нарушений
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
