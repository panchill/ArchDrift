import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { DisplayGraph, NodeMeta } from "./graph";
import type { NodeType } from "./types";

export const NODE_WIDTH = 300; // endpoint / worker card inside a service group
export const NODE_HEIGHT = 44;
export const GROUP_PADDING = 14;

export const nodeSize: Record<NodeType, { w: number; h: number }> = {
  service: { w: 210, h: 84 },
  endpoint: { w: NODE_WIDTH, h: NODE_HEIGHT },
  worker: { w: NODE_WIDTH, h: NODE_HEIGHT },
  postgres_database: { w: 130, h: 92 },
  kafka_topic: { w: 200, h: 64 },
};

export type Point = { x: number; y: number };
export type Route = { start: Point; bends: Point[]; end: Point };
export type Box = { x1: number; y1: number; x2: number; y2: number };
export interface Layout {
  positions: Map<string, Point>;
  routes: Map<string, Route>;
  groups: Map<string, Box>; // ELK frames of services with children
}

const elk = new ELK();
const options = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.separateConnectedComponents": "false",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.spacing.nodeNode": "36", // leaves room for group titles above frames
  "elk.spacing.edgeNode": "18",
  "elk.spacing.edgeEdge": "10",
  "elk.layered.spacing.edgeNodeBetweenLayers": "18",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "10",
};

/** Declared calls into a shared dependency (flagd) are drawn only on focus. */
export const hiddenEdge = (
  edge: DisplayGraph["edges"][number],
  owner: (id: string) => string,
  meta?: Map<string, NodeMeta>,
) => edge.status === "declared" && !!meta?.get(owner(edge.target))?.hub;

/** ELK layered layout, left to right, with orthogonal edge routes around nodes. */
export async function layoutGraph(
  graph: DisplayGraph,
  meta?: Map<string, NodeMeta>,
): Promise<Layout> {
  const nodes = [...graph.nodes].sort((a, b) =>
    a.node.id.localeCompare(b.node.id),
  );
  const byId = new Map(nodes.map((n) => [n.node.id, n.node]));
  const owner = (id: string) => {
    const node = byId.get(id);
    return node && "parentId" in node ? node.parentId : id;
  };
  const elkNodes = new Map<string, ElkNode>(
    nodes.map(({ node }) => [
      node.id,
      {
        id: node.id,
        width: nodeSize[node.type].w,
        height: nodeSize[node.type].h,
        // Shared dependencies sit in the last column, so their calls still point right.
        ...(meta?.get(node.id)?.hub
          ? { layoutOptions: { "elk.layered.layering.layerConstraint": "LAST" } }
          : {}),
      },
    ]),
  );
  const root: ElkNode = { id: "root", layoutOptions: options, children: [] };
  for (const { node } of nodes) {
    const item = elkNodes.get(node.id)!;
    const parent = "parentId" in node ? elkNodes.get(node.parentId) : root;
    if (!parent) continue;
    if (parent !== root) {
      delete parent.width;
      delete parent.height;
      parent.layoutOptions = {
        // Uniform, like Cytoscape compound padding, so both agree on the frame.
        "elk.padding": `[top=${GROUP_PADDING},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`,
      };
    }
    (parent.children ??= []).push(item);
  }
  root.edges = graph.edges
    .filter(
      (e) =>
        e.source !== e.target &&
        byId.has(e.source) &&
        byId.has(e.target) &&
        !hiddenEdge(e, owner, meta),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));
  const result = await elk.layout(root);

  const positions = new Map<string, Point>();
  const groups = new Map<string, Box>();
  const offsets = new Map<string, Point>([["root", { x: 0, y: 0 }]]);
  const walk = (node: ElkNode, origin: Point) => {
    for (const child of node.children ?? []) {
      const x = origin.x + (child.x ?? 0),
        y = origin.y + (child.y ?? 0);
      offsets.set(child.id, { x, y });
      positions.set(child.id, {
        x: x + (child.width ?? 0) / 2,
        y: y + (child.height ?? 0) / 2,
      });
      if (child.children?.length)
        groups.set(child.id, {
          x1: x,
          y1: y,
          x2: x + (child.width ?? 0),
          y2: y + (child.height ?? 0),
        });
      walk(child, { x, y });
    }
  };
  walk(result, { x: 0, y: 0 });
  const routes = new Map<string, Route>();
  const collect = (node: ElkNode) => {
    for (const edge of node.edges ?? []) {
      // With INCLUDE_CHILDREN, section coordinates are relative to the edge container.
      const container = (edge as { container?: string }).container ?? node.id;
      const o = offsets.get(container) ?? { x: 0, y: 0 };
      const section = edge.sections?.[0];
      if (!section) continue;
      const shift = (p: Point) => ({ x: p.x + o.x, y: p.y + o.y });
      routes.set(edge.id, {
        start: shift(section.startPoint),
        bends: (section.bendPoints ?? []).map(shift),
        end: shift(section.endPoint),
      });
    }
    node.children?.forEach(collect);
  };
  collect(result);
  return { positions, routes, groups };
}
