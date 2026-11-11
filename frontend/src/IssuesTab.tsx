import { JAEGER } from "./api";
import { edgeKey, serviceName, statusLabels } from "./graph";
import { callName, clockTime, perMinute, reason } from "./text";
import type { Analysis, Edge, EdgeStatus, GraphNode } from "./types";
export function IssuesTab({ snapshot, version, nodes, filter, setFilter, highlighted, onShow }: {
  snapshot: Analysis; version: number; nodes: Map<string, GraphNode>;
  filter: EdgeStatus | "all"; setFilter: (value: EdgeStatus | "all") => void; highlighted?: string; onShow: (edge: Edge) => void;
}) {
  const issues = snapshot.edges.filter(e => e.status !== "declared").sort((a, b) => Number(b.status === "unexpected") - Number(a.status === "unexpected") || b.observedOperations - a.observedOperations);
  return <main className="page page-wide">
    <div className="page-heading"><div><h1>Нарушения</h1><p className="muted">Модель v{version}</p></div><div className="segmented" aria-label="Фильтр нарушений">{(["all", "unexpected", "indeterminate"] as const).map(status => {
      const count = status === "all" ? issues.length : issues.filter(e => e.status === status).length;
      return status !== "all" && !count ? null : <button key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}>{status === "all" ? "Все" : `● ${statusLabels[status]}`} {count}</button>;
    })}</div></div>
    {!issues.length ? <p className="empty-state">Нарушений нет. Все наблюдаемые связи есть в модели.</p> : <div className="table-wrap"><table className="table issues-table"><thead><tr>{["Статус", "Связь", "Вызов", "Частота", "Впервые", ""].map((s, i) => <th key={i}>{s}</th>)}</tr></thead><tbody>{issues.filter(e => filter === "all" || e.status === filter).map(e => <tr key={edgeKey(e)} className={edgeKey(e) === highlighted ? "hl" : ""}>
      <td className={e.status}><span className={`status-dot ${e.status}`} /> {statusLabels[e.status]}</td>
      <td><span className="mono">{serviceName(e.source, nodes)} → {serviceName(e.target, nodes)}</span><small>{e.status === "unexpected" ? `Вызов, которого нет в модели v${version}` : reason(e, nodes)}</small></td>
      <td className="mono">{callName(e, nodes)}</td><td className="nowrap">{perMinute(e.observedOperations, snapshot)}/мин</td><td className="nowrap">{clockTime(e.firstSeenAt)}</td>
      <td><div className="actions"><button className="button ghost" onClick={() => onShow(e)}>На схеме</button><a className="button ghost" href={`${JAEGER}/trace/${e.exampleTraceId}`} target="_blank" rel="noreferrer">Трейс ↗</a></div></td>
    </tr>)}</tbody></table></div>}
  </main>;
}
