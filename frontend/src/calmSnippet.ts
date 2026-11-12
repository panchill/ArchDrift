import type { Edge, GraphNode, NodeDefinition } from "./types";
import { ownerId } from "./graph";
export function calmSnippet(edge: Edge, nodes: Map<string, GraphNode>, existingIds: string[] = []): string | { missing: string } {
  const s = nodes.get(ownerId(edge.source, nodes)), t = nodes.get(ownerId(edge.target, nodes));
  if (!s?.calmNodeId) return { missing: s?.node.label ?? "источник" };
  if (!t?.calmNodeId) return { missing: t?.node.label ?? "назначение" };
  const si = nodes.get(edge.source)?.calmInterfaceId, ti = nodes.get(edge.target)?.calmInterfaceId;
  const end = (node: string, iface?: string) => iface ? { node, interfaces: [iface] } : { node };
  const base = [si ?? s.calmNodeId, ti ?? t.calmNodeId].join("--to--"), used = new Set(existingIds);
  let id = base;
  for (let suffix = 2; used.has(id); suffix++) id = `${base}--${suffix}`;
  return JSON.stringify({
    "unique-id": id,
    "relationship-type": { connects: { source: end(s.calmNodeId, si), destination: end(t.calmNodeId, ti) } },
    metadata: { archdrift: { type: edge.type } },
  }, null, 2);
}

const slug = (value: string) => value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "node";
export const missingKind = (node?: NodeDefinition) =>
  node?.type === "postgres_database" ? "Базы" : node?.type === "kafka_topic" ? "Топика" : "Сервиса";

type Side = { id: string; iface?: string; node?: object; label?: string };

/** CALM node (and the interface the call hit) for a graph element the model does not know yet. */
function proposeSide(elementId: string, nodes: Map<string, GraphNode>): Side {
  const owner = nodes.get(ownerId(elementId, nodes)), element = nodes.get(elementId);
  if (owner?.calmNodeId) return { id: owner.calmNodeId, iface: element?.calmInterfaceId };
  const def = owner?.node;
  const description = "Найден в трейсах ArchDrift, в модели не было";
  if (def?.type === "postgres_database") {
    const id = slug(`${def.instance}-${def.database}`);
    return { id, label: def.label, node: { "unique-id": id, "node-type": "database", name: def.database, description, metadata: { archdrift: { instance: def.instance, database: def.database } } } };
  }
  if (def?.type === "kafka_topic") {
    const id = `${slug(def.topic)}-topic`;
    return { id, label: def.label, node: { "unique-id": id, "node-type": "kafka-topic", name: def.topic, description, metadata: { archdrift: { cluster: def.cluster, topic: def.topic } } } };
  }
  const serviceName = def?.type === "service" ? def.serviceName : def?.label ?? "service";
  const id = slug(serviceName);
  const endpoint = element?.node.type === "endpoint" ? element.node : undefined;
  const iface = endpoint ? `${id}--${endpoint.method.toLowerCase()}-${slug(endpoint.route)}` : undefined;
  const node = {
    "unique-id": id, "node-type": "service", name: def?.label ?? serviceName, description,
    ...(endpoint && iface ? { interfaces: [{ "unique-id": iface, metadata: { archdrift: { method: endpoint.method, route: endpoint.route } } }] } : {}),
    metadata: { archdrift: { serviceName } },
  };
  return { id, iface, label: def?.label ?? serviceName, node };
}

/**
 * Ready-to-paste fix for an unexpected edge. When both ends are in the model it is the
 * relationship alone; otherwise the missing nodes come first, as a { nodes, relationships } fragment.
 */
export function calmPatch(edge: Edge, nodes: Map<string, GraphNode>, existingIds: string[] = []): { text: string; missing: { label: string; kind: string }[] } {
  const s = proposeSide(edge.source, nodes), t = proposeSide(edge.target, nodes);
  const end = (side: Side) => side.iface ? { node: side.id, interfaces: [side.iface] } : { node: side.id };
  const relationship = {
    "unique-id": `${s.iface ?? s.id}--to--${t.iface ?? t.id}`,
    "relationship-type": { connects: { source: end(s), destination: end(t) } },
    metadata: { archdrift: { type: edge.type } },
  };
  const added = [s, t].filter(side => side.node);
  const missing = added.map(side => ({ label: side.label ?? side.id, kind: missingKind(nodes.get(ownerId(side === s ? edge.source : edge.target, nodes))?.node) }));
  const text = added.length
    ? JSON.stringify({ nodes: added.map(side => side.node), relationships: [relationship] }, null, 2)
    : calmSnippet(edge, nodes, existingIds) as string;
  return { text, missing };
}
