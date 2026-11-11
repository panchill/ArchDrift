import type { Edge, GraphNode } from "./types";
import { ownerId } from "./graph";
export function calmSnippet(edge: Edge, nodes: Map<string, GraphNode>): string | { missing: string } {
  const s = nodes.get(ownerId(edge.source, nodes)), t = nodes.get(ownerId(edge.target, nodes));
  if (!s?.calmNodeId) return { missing: s?.node.label ?? "источник" };
  if (!t?.calmNodeId) return { missing: t?.node.label ?? "назначение" };
  const si = nodes.get(edge.source)?.calmInterfaceId, ti = nodes.get(edge.target)?.calmInterfaceId;
  const end = (node: string, iface?: string) => iface ? { node, interfaces: [iface] } : { node };
  return JSON.stringify({
    "unique-id": [si ?? s.calmNodeId, ti ?? t.calmNodeId].join("--to--"),
    "relationship-type": { connects: { source: end(s.calmNodeId, si), destination: end(t.calmNodeId, ti) } },
    metadata: { archdrift: { type: edge.type } },
  }, null, 2);
}
