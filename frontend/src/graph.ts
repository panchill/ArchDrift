import type { ElementDefinition } from "cytoscape";
import type { Analysis, Edge, EdgeStatus, GraphNode } from "./types";

export type GraphView = "services" | "details";
export interface DisplayEdge extends Edge {
  id: string;
  members: Edge[];
  statuses: Record<EdgeStatus, number>;
}
export interface DisplayGraph {
  nodes: GraphNode[];
  edges: DisplayEdge[];
}
export const statusLabels: Record<EdgeStatus, string> = {
  declared: "По декларации",
  unexpected: "Вне декларации",
  indeterminate: "Недостаточно данных",
};
const edgeLabels = {
  http_call: "HTTP",
  db_query: "SQL",
  publish: "publish",
  consume: "consume",
};
export interface NodeMeta {
  caption: string;
  opsPerMinute: number;
  violations: number;
  hub: boolean;
  hubs: string[];
}
const HUB_CALLERS = 5;

/** Card captions and status lines, computed from the full snapshot so the
 * overview still knows how many endpoints a collapsed service has. */
export function nodeMeta(analysis: Analysis): Map<string, NodeMeta> {
  const byId = new Map(analysis.nodes.map((n) => [n.node.id, n.node]));
  const owner = (id: string) => {
    const node = byId.get(id);
    return node && "parentId" in node ? node.parentId : id;
  };
  const minutes =
    Math.max(1, Date.parse(analysis.to) - Date.parse(analysis.from)) / 60000;
  const meta = new Map<string, NodeMeta>();
  const get = (id: string) => {
    if (!meta.has(id))
      meta.set(id, {
        caption: "",
        opsPerMinute: 0,
        violations: 0,
        hub: false,
        hubs: [],
      });
    return meta.get(id)!;
  };
  for (const { node } of analysis.nodes) {
    const item = get(node.id);
    if (node.type === "kafka_topic") item.caption = `Kafka · ${node.cluster}`;
    if (node.type === "postgres_database") item.caption = "PostgreSQL";
    if (node.type === "service") {
      const kids = analysis.nodes.filter(
        (n) => "parentId" in n.node && n.node.parentId === node.id,
      );
      const endpoints = kids.filter((n) => n.node.type === "endpoint").length;
      const workers = kids.length - endpoints;
      item.caption =
        [
          endpoints ? `${endpoints} endpoint${endpoints > 1 ? "s" : ""}` : "",
          workers ? `${workers} воркер` : "",
        ]
          .filter(Boolean)
          .join(" · ") || "сервис";
    }
  }
  for (const edge of analysis.edges) {
    const ends = [edge.source, owner(edge.source), edge.target, owner(edge.target)];
    for (const id of new Set(ends))
      get(id).opsPerMinute += edge.observedOperations / minutes;
    if (edge.status === "unexpected")
      for (const id of new Set(ends.slice(0, 2))) get(id).violations++;
  }
  // Hub: a shared dependency called by many services, all calls as declared.
  const callers = new Map<string, Set<string>>();
  const clean = new Map<string, boolean>();
  for (const edge of analysis.edges) {
    const source = owner(edge.source),
      target = owner(edge.target);
    if (source === target || byId.get(target)?.type !== "service") continue;
    callers.set(target, (callers.get(target) ?? new Set()).add(source));
    clean.set(target, (clean.get(target) ?? true) && edge.status === "declared");
  }
  for (const [target, sources] of callers) {
    if (sources.size < HUB_CALLERS || !clean.get(target)) continue;
    get(target).hub = true;
    for (const source of sources) get(source).hubs.push(byId.get(target)!.label);
  }
  return meta;
}

export const edgeKey = (
  edge: Pick<Edge, "source" | "target" | "type" | "dbOperation">,
) =>
  JSON.stringify([
    edge.source,
    edge.target,
    edge.type,
    edge.dbOperation ?? null,
  ]);

export function buildGraph(
  analysis: Analysis,
  view: GraphView,
  status: EdgeStatus | "all" = "all",
  query = "",
  expanded?: Set<string>, // details view: open services and the endpoints shown in them; all when omitted
): DisplayGraph {
  const byId = new Map(analysis.nodes.map((n) => [n.node.id, n]));
  const open = (id: string) =>
    view === "details" && (!expanded || expanded.has(id));
  const owner = (id: string) => {
    const node = byId.get(id)?.node;
    return node && "parentId" in node && !(open(node.parentId) && open(id))
      ? node.parentId
      : id;
  };
  let nodes = analysis.nodes.filter((n) => owner(n.node.id) === n.node.id);
  const groups = new Map<string, DisplayEdge>();
  // Filter BEFORE aggregation: a single unexpected call must remain discoverable.
  for (const edge of analysis.edges) {
    if (status !== "all" && edge.status !== status) continue;
    const mapped = {
      ...edge,
      source: owner(edge.source),
      target: owner(edge.target),
    };
    const id = edgeKey(mapped);
    const current = groups.get(id);
    if (!current) {
      const statuses = { declared: 0, unexpected: 0, indeterminate: 0 };
      statuses[edge.status] = 1;
      groups.set(id, { ...mapped, id, members: [edge], statuses });
    } else {
      const count = current.observedOperations + edge.observedOperations;
      current.avgDurationMs =
        (current.avgDurationMs * current.observedOperations +
          edge.avgDurationMs * edge.observedOperations) /
        count;
      current.observedOperations = count;
      current.errorOperations += edge.errorOperations;
      current.firstSeenAt =
        Date.parse(current.firstSeenAt) < Date.parse(edge.firstSeenAt)
          ? current.firstSeenAt
          : edge.firstSeenAt;
      current.lastSeenAt =
        Date.parse(current.lastSeenAt) > Date.parse(edge.lastSeenAt)
          ? current.lastSeenAt
          : edge.lastSeenAt;
      current.matchedRelationshipIds = [
        ...new Set([
          ...current.matchedRelationshipIds,
          ...edge.matchedRelationshipIds,
        ]),
      ].sort();
      current.members.push(edge);
      current.statuses[edge.status]++;
      const priority = { declared: 0, indeterminate: 1, unexpected: 2 };
      if (priority[edge.status] > priority[current.status]) {
        current.status = edge.status;
        current.exampleTraceId = edge.exampleTraceId;
        current.exampleSpanId = edge.exampleSpanId;
      }
    }
  }
  let edges = [...groups.values()];
  const term = query.trim().toLocaleLowerCase();
  if (term) {
    // Search detailed identity even in the overview (e.g. /payments or worker name).
    const matches = new Set(
      analysis.nodes
        .filter((n) =>
          JSON.stringify(n.node).toLocaleLowerCase().includes(term),
        )
        .map((n) => owner(n.node.id)),
    );
    if (view === "details") {
      for (const { node } of analysis.nodes) {
        if ("parentId" in node && matches.has(node.parentId))
          matches.add(node.id);
      }
    }
    edges = edges.filter((e) => matches.has(e.source) || matches.has(e.target));
    const visible = new Set([
      ...matches,
      ...edges.flatMap((e) => [e.source, e.target]),
    ]);
    nodes = nodes.filter((n) => visible.has(n.node.id));
  }
  if (status !== "all") {
    const connected = new Set(edges.flatMap((e) => [e.source, e.target]));
    nodes = nodes.filter((n) => connected.has(n.node.id));
  }
  if (view === "details") {
    const parents = new Set(
      nodes.flatMap((n) => ("parentId" in n.node ? [n.node.parentId] : [])),
    );
    nodes = [
      ...nodes,
      ...analysis.nodes.filter(
        (n) =>
          parents.has(n.node.id) && !nodes.some((v) => v.node.id === n.node.id),
      ),
    ];
  }
  return { nodes, edges };
}

export function graphElements(graph: DisplayGraph): ElementDefinition[] {
  return [
    ...graph.nodes.map(({ node, known, observed }) => ({
      data: {
        id: node.id,
        label: node.label,
        kind: node.type,
        ...("parentId" in node ? { parent: node.parentId } : {}),
      },
      classes: `${node.type} ${known ? "" : "unknown"} ${observed ? "" : "unobserved"}`,
    })),
    ...graph.edges.map((edge) => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.dbOperation ?? edgeLabels[edge.type],
        status: edge.status,
      },
      classes: edge.status,
    })),
  ];
}
