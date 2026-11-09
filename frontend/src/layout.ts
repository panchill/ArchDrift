import type { DisplayGraph } from "./graph";

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 42;
export const CHILD_STEP = 58;
const COLUMN_STEP = 320;
const GROUP_GAP = 70;

/** Place service groups in HTTP dependency order; keep children in readable rows.
 * Compound bounds come from children, never from a second force simulation.
 * Cyclic services share a column rather than growing ranks indefinitely.
 */
export function architecturePositions(
  graph: DisplayGraph,
): Map<string, { x: number; y: number }> {
  const nodes = [...graph.nodes].sort((a, b) =>
    a.node.id.localeCompare(b.node.id),
  );
  const byId = new Map(nodes.map((n) => [n.node.id, n.node]));
  const services = nodes.filter((n) => n.node.type === "service");
  const serviceIds = new Set(services.map((n) => n.node.id));
  const owner = (id: string) => {
    const node = byId.get(id);
    return node && "parentId" in node ? node.parentId : id;
  };
  const outgoing = new Map(
    [...serviceIds].map((id) => [id, new Set<string>()]),
  );
  const incoming = new Map([...serviceIds].map((id) => [id, 0]));
  for (const edge of graph.edges) {
    const source = owner(edge.source),
      target = owner(edge.target);
    if (
      edge.type !== "http_call" ||
      source === target ||
      !serviceIds.has(source) ||
      !serviceIds.has(target)
    )
      continue;
    if (!outgoing.get(source)!.has(target)) {
      outgoing.get(source)!.add(target);
      incoming.set(target, incoming.get(target)! + 1);
    }
  }
  const ranks = new Map([...serviceIds].map((id) => [id, 0]));
  const queue = [...serviceIds].filter((id) => incoming.get(id) === 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const target of outgoing.get(id)!) {
      ranks.set(target, Math.max(ranks.get(target)!, ranks.get(id)! + 1));
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  // Bound long call chains too: extra groups stack vertically in the last lane.
  for (const id of serviceIds) ranks.set(id, Math.min(ranks.get(id)!, 2));
  const positions = new Map<string, { x: number; y: number }>();
  const nextY = new Map<number, number>();
  for (const item of services) {
    const rank = ranks.get(item.node.id)!;
    const x = 150 + rank * COLUMN_STEP;
    const y = nextY.get(rank) ?? 70;
    const children = nodes.filter(
      (n) => "parentId" in n.node && n.node.parentId === item.node.id,
    );
    children.forEach((child, index) =>
      positions.set(child.node.id, { x, y: y + index * CHILD_STEP }),
    );
    positions.set(item.node.id, {
      x,
      y: y + (Math.max(0, children.length - 1) * CHILD_STEP) / 2,
    });
    nextY.set(
      rank,
      y + Math.max(NODE_HEIGHT, children.length * CHILD_STEP) + GROUP_GAP,
    );
  }
  const resourceX = services.length
    ? 150 + (Math.max(...ranks.values()) + 1) * COLUMN_STEP
    : 150;
  // Databases and topics stay in distinct adjacent sections of the resource lane.
  const resources = nodes
    .filter(
      (n) =>
        n.node.type === "postgres_database" || n.node.type === "kafka_topic",
    )
    .sort(
      (a, b) =>
        a.node.type.localeCompare(b.node.type) * -1 ||
        a.node.id.localeCompare(b.node.id),
    );
  resources.forEach((item, index) =>
    positions.set(item.node.id, { x: resourceX, y: 70 + index * 84 }),
  );
  return positions;
}
