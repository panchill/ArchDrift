import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadAnalysis, loadArchitecture } from "./api";
import { GraphCanvas, type Direction, type Theme } from "./GraphCanvas";
import { buildGraph, edgeKey, findSearchMatches, nodeMeta, ownerId, serviceEdgeId, serviceName, servicesWithoutTraffic, statusLabels } from "./graph";
import { ModelTab } from "./ModelTab";
import { ModelEditor } from "./ModelEditor";
import { IssuesTab } from "./IssuesTab";
import { Inspector } from "./Inspector";
import { useHashTab, type Tab } from "./useHashTab";
import type { Point } from "./layout";
import { windowMinutes } from "./text";
import type { Analysis, Architecture, Edge, EdgeStatus } from "./types";
import "./styles.css";

const POLL_MS = 5000;
export default function App() {
  const [architecture, setArchitecture] = useState<Architecture | null | undefined>();
  const [snapshot, setSnapshot] = useState<Analysis | null>(null);
  const [tab, setTab] = useHashTab();
  const [error, setError] = useState(false), [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false), [query, setQuery] = useState("");
  const [navigation, setNavigation] = useState(0);
  const [matchIndex, setMatchIndex] = useState(0);
  const [positions, setPositions] = useState(new Map<string, Point>());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>("out");
  const [theme, setTheme] = useState<Theme>("dark");
  const [toast, setToast] = useState<{ keys: string[]; at: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [issuesFilter, setIssuesFilter] = useState<EdgeStatus | "all">("all");
  const [highlighted, setHighlighted] = useState<string>();
  const [uploaded, setUploaded] = useState<{ name: string; version: number }>();
  const [editing, setEditing] = useState<Architecture | null>(null);
  const architectureRef = useRef(architecture), snapshotRef = useRef(snapshot);
  const previous = useRef<Set<string> | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const onSelect = useCallback((id: string | null) => { setSelected(id); setDirection(snapshotRef.current?.nodes.find(n => n.node.id === id)?.node.type === "kafka_topic" ? "in" : "out"); }, []);
  const onExpand = useCallback((id: string) => { setExpanded(old => old === id ? null : id); setSelected(id); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (architecture === null && tab !== "model") setTab("model"); }, [architecture, tab, setTab]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSelected(null); setQuery(""); setMatchIndex(0); }
      if (event.key === "/" && !(event.target instanceof HTMLElement && (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)))) { event.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), Math.max(0, 20000 - (Date.now() - toast.at)));
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const saveArchitecture = (value: Architecture | null) => { architectureRef.current = value; setArchitecture(value); };
    async function poll() {
      try {
        let model = architectureRef.current;
        if (!model) model = await loadArchitecture(controller.signal);
        if (controller.signal.aborted) return;
        saveArchitecture(model);
        if (!model) { snapshotRef.current = null; setSnapshot(null); setToast(null); setSelected(null); }
        else {
          const data = await loadAnalysis(controller.signal);
          if (controller.signal.aborted) return;
          if (!data) { saveArchitecture(null); snapshotRef.current = null; setSnapshot(null); setToast(null); setSelected(null); }
          else {
            if (data.architectureVersion !== model.version) {
              model = await loadArchitecture(controller.signal);
              if (controller.signal.aborted) return;
              saveArchitecture(model);
            }
            // Never combine analysis with a different model revision during a concurrent upload.
            if (model && model.version === data.architectureVersion) {
              const keys = new Set(data.edges.filter(e => e.status === "unexpected").map(edgeKey));
              const fresh = [...keys].filter(k => previous.current && !previous.current.has(k));
              previous.current = keys;
              if (fresh.length) setToast({ keys: fresh, at: Date.now() });
              else setToast(old => old && old.keys.some(k => keys.has(k)) ? { ...old, keys: old.keys.filter(k => keys.has(k)) } : null);
              snapshotRef.current = data;
              setSnapshot(old => JSON.stringify(old) === JSON.stringify(data) ? old : data);
            } else { snapshotRef.current = null; setSnapshot(null); }
          }
        }
        setError(false); setOffline(false);
      } catch {
        if (!controller.signal.aborted) {
          if (snapshotRef.current || architectureRef.current === null) setOffline(true);
          else setError(true);
        }
      } finally { if (!controller.signal.aborted) timer = setTimeout(poll, POLL_MS); }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [attempt]);
  const nodes = useMemo(() => new Map(snapshot?.nodes.map(n => [n.node.id, n]) ?? []), [snapshot]);
  const open = useMemo(() => {
    const ids = new Set<string>();
    if (!expanded || !snapshot) return ids;
    // Keep #44's directional expansion: outgoing opens callees, incoming opens this service.
    const inside = (id: string) => id === expanded || ownerId(id, nodes) === expanded;
    for (const e of snapshot.edges) {
      const [from, to] = direction === "out" ? [e.source, e.target] : [e.target, e.source];
      if (!inside(from) || ownerId(to, nodes) === expanded) continue;
      const end = direction === "out" ? to : from;
      ids.add(ownerId(end, nodes)).add(end);
    }
    // A service without calls can still expose its declared endpoints.
    if (!ids.size) for (const { node } of snapshot.nodes) if ("parentId" in node && node.parentId === expanded) ids.add(expanded).add(node.id);
    return ids;
  }, [expanded, direction, snapshot, nodes]);
  const view = expanded ? "details" : "services";
  const graph = useMemo(() => {
    if (!snapshot) return { nodes: [], edges: [] };
    const full = buildGraph(snapshot, view, "all", open);
    if (!onlyProblems) return full;
    const edges = full.edges.filter(e => e.status !== "declared"), keep = new Set(edges.flatMap(e => [e.source, e.target]));
    for (const { node } of full.nodes) if (keep.has(node.id) && "parentId" in node) keep.add(node.parentId);
    return { nodes: full.nodes.filter(n => keep.has(n.node.id)), edges };
  }, [snapshot, view, open, onlyProblems]);
  const idle = useMemo(() => snapshot ? servicesWithoutTraffic(snapshot) : new Set<string>(), [snapshot]);
  const matches = useMemo(() => findSearchMatches(graph.nodes, query, positions), [graph, query, positions]);
  const match = matches.length ? matchIndex % matches.length : 0;
  const moveMatch = (delta: number) => {
    if (matches.length > 1)
      setMatchIndex(index => (index % matches.length + delta + matches.length) % matches.length);
  };
  const missing = !!query.trim() && !matches.length;
  const meta = useMemo(() => snapshot ? nodeMeta(snapshot) : undefined, [snapshot]);
  const edge = graph.edges.find(e => e.id === selected), item = graph.nodes.find(n => n.node.id === selected);
  useEffect(() => { if (selected && !edge && !item) setSelected(null); }, [selected, edge, item]);
  const violations = snapshot?.edges.filter(e => e.status === "unexpected").length ?? 0;
  const issues = snapshot?.edges.filter(e => e.status !== "declared").length ?? 0;
  const changeTab = (value: Tab) => { setTab(value); setHighlighted(undefined); };
  const show = (e: Edge) => { setTab("graph"); setQuery(""); setMatchIndex(0); setOnlyProblems(false); setExpanded(null); setSelected(serviceEdgeId(e, nodes)); setNavigation(value => value + 1); };
  const fresh = snapshot?.edges.filter(e => toast?.keys.includes(edgeKey(e)) && e.status === "unexpected") ?? [];
  const showToast = () => {
    if (fresh.length === 1) show(fresh[0]);
    else { setIssuesFilter("unexpected"); setHighlighted(fresh.sort((a, b) => b.observedOperations - a.observedOperations)[0] ? edgeKey(fresh[0]) : undefined); setTab("issues"); }
    setToast(null);
  };
  return <div className="app">
    <header className="topbar"><a className="brand" href="#/graph"><span className="brand-mark">a.</span>archdrift</a><span className="brand-separator">/</span><span className="project">Astronomy Shop</span>
      <nav role="tablist" aria-label="Разделы">{([ ["graph", "Схема"], ["issues", "Нарушения"], ["model", "Модель"] ] as const).map(([value, label]) => <button className="tab" role="tab" key={value} aria-selected={(architecture === null ? "model" : tab) === value} disabled={value !== "model" && !architecture} onClick={() => changeTab(value)}>{label}{value === "issues" && !!architecture && issues > 0 && <span className={`pill ${violations ? "bad" : ""}`}>{issues}</span>}{value === "model" && architecture && <span className="pill">v{architecture.version}</span>}</button>)}</nav>
      <div className="topbar-right"><button className="icon-button" aria-label="Переключить тему" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}>{theme === "dark" ? "☾" : "☀"}</button></div>
    </header>
    {error && !snapshot ? <section className="error-state" role="alert"><h2>Не удалось загрузить данные</h2><button className="button" onClick={() => { setError(false); setAttempt(a => a + 1); }}>Повторить</button></section>
      : architecture === undefined ? <div className="loading" role="status">Загрузка архитектуры…</div>
      : tab === "model" || !architecture ? <ModelTab architecture={architecture} snapshot={snapshot} uploadedFile={uploaded?.version === architecture?.version ? uploaded?.name : undefined} onEdit={() => setEditing(architecture)} onGraph={() => setTab("graph")} onUploaded={(value, name) => {
        architectureRef.current = value; setArchitecture(value); setUploaded({ name, version: value.version }); setAttempt(a => a + 1);
      }} onReset={() => {
        architectureRef.current = null; snapshotRef.current = null; previous.current = null;
        setArchitecture(null); setSnapshot(null); setSelected(null); setExpanded(null); setQuery(""); setToast(null); setUploaded(undefined); setNotice("Модель сброшена"); setAttempt(a => a + 1);
      }} />
      : !snapshot ? <div className="loading" role="status">Загрузка анализа…</div>
      : tab === "issues" ? <IssuesTab snapshot={snapshot} version={architecture.version} nodes={nodes} filter={issuesFilter} setFilter={setIssuesFilter} highlighted={highlighted} onShow={show} />
      : <div className="workspace"><section className="canvas-area">
        <GraphCanvas graph={graph} idle={idle} minutes={Math.round(windowMinutes(snapshot))} searchTarget={matches[match]} onPositions={setPositions} navigation={navigation} selected={selected} onSelect={onSelect} onToggleExpand={onExpand} meta={meta} theme={theme} direction={item?.node.type === "postgres_database" ? "in" : item && "parentId" in item.node ? undefined : direction} view={view} />
        <div className="float toolbar">
          <div className="graph-search">
            <input ref={search} type="search" aria-label="Найти на схеме" placeholder="Найти на схеме"
              value={query} aria-invalid={missing}
              onChange={e => { setQuery(e.target.value); setMatchIndex(0); if (e.target.value.trim()) setSelected(null); }}
              onKeyDown={e => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                e.preventDefault();
                moveMatch(e.shiftKey ? -1 : 1);
              }} />
            {query.trim() && <div className="search-controls">
              <span role="status">{missing ? "Не найдено" : `${match + 1} из ${matches.length}`}</span>
              {matches.length > 1 && <>
                <button type="button" aria-label="Предыдущее совпадение" title="Предыдущее совпадение (Shift+Enter)" onClick={() => moveMatch(-1)}>↑</button>
                <button type="button" aria-label="Следующее совпадение" title="Следующее совпадение (Enter)" onClick={() => moveMatch(1)}>↓</button>
              </>}
            </div>}
          </div>
          <div className="segmented"><button aria-pressed={!onlyProblems} onClick={() => { setOnlyProblems(false); setSelected(null); }}>Все связи</button><button aria-pressed={onlyProblems} onClick={() => { setOnlyProblems(true); setSelected(null); }}>Только проблемные</button></div>
        </div>
        {!violations && !toast && !offline && <div className="toast ok graph-result">● Все наблюдаемые связи есть в модели</div>}
        <div className="float legend" aria-label="Легенда графа">{Object.entries(statusLabels).map(([key, label]) => <span key={key}><i className={`legend-line ${key}`} />{label}</span>)}<span><i className="legend-idle" />Есть в модели, нет трафика</span></div>
      </section>{selected && <Inspector edge={edge} item={item} architecture={architecture} snapshot={snapshot} nodes={nodes} meta={meta?.get(selected)} direction={direction} setDirection={setDirection} expanded={expanded} onExpand={onExpand} onShow={show} onClose={() => setSelected(null)} />}</div>}
    {editing && <ModelEditor architecture={editing} onCancel={() => setEditing(null)} onSaved={value => {
      architectureRef.current = value; setArchitecture(value); setUploaded(undefined); setEditing(null); setAttempt(a => a + 1);
    }} />}
    {offline ? <div className="toast info global-toast" role="status">Нет связи с сервером, пробуем снова</div> : toast && fresh.length > 0 && <div className="toast bad global-toast" role="status">● {fresh.length === 1 ? `Новое нарушение: ${serviceName(fresh[0].source, nodes)} → ${serviceName(fresh[0].target, nodes)}` : `Новые нарушения: ${fresh.length}`} <span className="muted">· только что</span><button className="button ghost" onClick={showToast}>Показать</button></div>}
    {notice && <div className="toast ok global-toast" role="status">{notice}</div>}
  </div>;
}
