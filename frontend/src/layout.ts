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
  height?: number;
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
  hint?: Map<string, Point>, // previous centres: keep columns and order when known
): Promise<Layout> {
  const nodes = [...graph.nodes].sort((a, b) =>
    a.node.id.localeCompare(b.node.id),
  );
  const byId = new Map(nodes.map((n) => [n.node.id, n.node]));
  const owner = (id: string) => {
    const node = byId.get(id);
    return node && "parentId" in node ? node.parentId : id;
  };
  // Interactive ELK reads layers from x and order from y; needs every top-level node.
  const interactive =
    !!hint?.size && nodes.every(({ node }) => "parentId" in node || hint.has(node.id));
  const at = (id: string, i: number) => {
    const p = hint?.get(id) ?? hint?.get(owner(id));
    const { w, h } = nodeSize[byId.get(id)!.type];
    // New endpoints of a just-opened service: stack in id order inside its card.
    return p && hint?.has(id) ? { x: p.x - w / 2, y: p.y - h / 2 } : { x: p?.x ?? 0, y: (p?.y ?? 0) + i };
  };
  const elkNodes = new Map<string, ElkNode>(
    nodes.map(({ node }, i) => [
      node.id,
      {
        id: node.id,
        width: nodeSize[node.type].w,
        height: nodeSize[node.type].h,
        ...(interactive ? at(node.id, i) : {}),
        // Shared dependencies sit in the last column, so their calls still point right.
        ...(meta?.get(node.id)?.hub
          ? { layoutOptions: { "elk.layered.layering.layerConstraint": "LAST" } }
          : {}),
      },
    ]),
  );
  // Groups must repeat the root's hierarchical strategies, ELK rejects a mix.
  const strategies: Record<string, string> = interactive
    ? {
        "elk.layered.cycleBreaking.strategy": "INTERACTIVE",
        "elk.layered.layering.strategy": "INTERACTIVE",
        "elk.layered.crossingMinimization.strategy": "INTERACTIVE",
      }
    : {};
  const root: ElkNode = {
    id: "root",
    layoutOptions: { ...options, ...strategies },
    children: [],
  };
  for (const { node } of nodes) {
    const item = elkNodes.get(node.id)!;
    const parent = "parentId" in node ? elkNodes.get(node.parentId) : root;
    if (!parent) continue;
    if (parent !== root) {
      delete parent.width;
      delete parent.height;
      parent.layoutOptions = {
        ...strategies,
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
  return { positions, routes, groups, height: result.height };
}

/** Place disconnected services below the main layout, including any open endpoints. */
export function placeNoTraffic(layout: Layout, idle: DisplayGraph["nodes"]): Layout {
  if (!idle.length) return layout;
  const positions = new Map(layout.positions);
  const cards = idle.filter(({ node }) => node.type === "service")
    .sort((a, b) => a.node.label.localeCompare(b.node.label));
  const { w, h } = nodeSize.service;
  const cellWidth = idle.length > cards.length ? NODE_WIDTH + 2 * GROUP_PADDING : w;
  let y = (layout.height ?? 0) + 2 * h;
  for (let i = 0; i < cards.length; i += 5) {
    let rowHeight = h;
    cards.slice(i, i + 5).forEach(({ node }, column) => {
      const x = cellWidth / 2 + column * (cellWidth + 24);
      positions.set(node.id, { x, y: y + h / 2 });
      const children = idle.filter(n => "parentId" in n.node && n.node.parentId === node.id);
      children.forEach((child, index) => positions.set(child.node.id, {
        x, y: y + GROUP_PADDING + NODE_HEIGHT / 2 + index * (NODE_HEIGHT + 10),
      }));
      if (children.length) rowHeight = Math.max(rowHeight, 2 * GROUP_PADDING + children.length * (NODE_HEIGHT + 10));
    });
    y += rowHeight + 24;
  }
  return { ...layout, positions };
}
