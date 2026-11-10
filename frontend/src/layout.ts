import type { DisplayGraph } from "./graph";
import type { NodeType } from "./types";

export const NODE_WIDTH = 300; // endpoint / worker card inside a service group
export const NODE_HEIGHT = 44;
export const CHILD_STEP = 56;
export const GROUP_PADDING = 14;
const GROUP_LABEL = 26; // compound title sits above the frame
const COLUMN_GAP = 110;
const ROW_GAP = 34;

export const nodeSize: Record<NodeType, { w: number; h: number }> = {
  service: { w: 210, h: 84 },
  endpoint: { w: NODE_WIDTH, h: NODE_HEIGHT },
  worker: { w: NODE_WIDTH, h: NODE_HEIGHT },
  postgres_database: { w: 130, h: 92 },
  kafka_topic: { w: 200, h: 64 },
};

type Point = { x: number; y: number };

/** Layered left-to-right layout: rank = longest call path over all edge types
 * (http, publish, consume, db), cycles broken by DFS back edges, column order
 * by barycenter sweeps, rows pulled towards their predecessors.
 */
export function architecturePositions(graph: DisplayGraph): Map<string, Point> {
  const nodes = [...graph.nodes].sort((a, b) =>
    a.node.id.localeCompare(b.node.id),
  );
  const byId = new Map(nodes.map((n) => [n.node.id, n.node]));
  const owner = (id: string) => {
    const node = byId.get(id);
    return node && "parentId" in node ? node.parentId : id;
  };
  const children = new Map<string, string[]>();
  for (const { node } of nodes)
    if ("parentId" in node)
      children.set(node.parentId, [
        ...(children.get(node.parentId) ?? []),
        node.id,
      ]);
  const top = nodes.filter((n) => !("parentId" in n.node)).map((n) => n.node);
  const ids = top.map((n) => n.id);
  const size = new Map(
    top.map((n) => {
      const kids = children.get(n.id)?.length ?? 0;
      if (!kids) return [n.id, nodeSize[n.type]];
      return [
        n.id,
        {
          w: NODE_WIDTH + 2 * GROUP_PADDING,
          h:
            GROUP_LABEL +
            (kids - 1) * CHILD_STEP +
            NODE_HEIGHT +
            2 * GROUP_PADDING,
        },
      ];
    }),
  );

  const out = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const e of graph.edges) {
    const s = owner(e.source),
      t = owner(e.target);
    if (s !== t && out.has(s) && out.has(t)) out.get(s)!.add(t);
  }
  const succ = new Map(ids.map((id) => [id, [...out.get(id)!].sort()]));
  // Break cycles: drop edges that point back onto the DFS stack.
  const state = new Map<string, 1 | 2>();
  const dag = new Map(ids.map((id) => [id, [] as string[]]));
  const visit = (id: string) => {
    state.set(id, 1);
    for (const t of succ.get(id)!) {
      if (state.get(t) === 1) continue;
      dag.get(id)!.push(t);
      if (!state.has(t)) visit(t);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  const pred = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [s, ts] of dag) for (const t of ts) pred.get(t)!.push(s);

  const rank = new Map<string, number>();
  const rankOf = (id: string): number => {
    if (!rank.has(id))
      rank.set(id, Math.max(-1, ...pred.get(id)!.map(rankOf)) + 1);
    return rank.get(id)!;
  };
  ids.forEach(rankOf);
  const columns: string[][] = [];
  for (const id of ids) (columns[rank.get(id)!] ??= []).push(id);
  // Isolated nodes go to the bottom of the first column, not between chains.
  const isolated = (id: string) =>
    !pred.get(id)!.length && !dag.get(id)!.length;
  columns[0]?.sort((a, b) => Number(isolated(a)) - Number(isolated(b)));

  const order = new Map<string, number>();
  const index = () =>
    columns.forEach((col) =>
      col.forEach((id, i) => order.set(id, (i + 0.5) / col.length)),
    );
  index();
  const sweep = (col: string[], near: Map<string, string[]>) => {
    const score = (id: string) => {
      const list = near.get(id)!;
      return list.length
        ? list.reduce((sum, n) => sum + order.get(n)!, 0) / list.length
        : order.get(id)!;
    };
    const scores = new Map(col.map((id) => [id, score(id)]));
    col.sort((a, b) => scores.get(a)! - scores.get(b)! || a.localeCompare(b));
  };
  for (let pass = 0; pass < 4; pass++) {
    for (let r = 1; r < columns.length; r++) sweep(columns[r], pred);
    index();
    for (let r = columns.length - 2; r >= 0; r--) sweep(columns[r], dag);
    index();
  }

  // Rows: each node wants the mean centre of its predecessors, without overlap.
  const y = new Map<string, number>();
  const place = (col: string[], near: Map<string, string[]>) => {
    let floor = 0;
    for (const id of col) {
      const h = size.get(id)!.h;
      const list = near.get(id)!.filter((n) => y.has(n));
      const want = list.length
        ? list.reduce((s, n) => s + y.get(n)! + size.get(n)!.h / 2, 0) /
            list.length -
          h / 2
        : floor;
      y.set(id, Math.round(Math.max(floor, want)));
      floor = y.get(id)! + h + ROW_GAP;
    }
  };
  columns.forEach((col) => place(col, pred));

  const positions = new Map<string, Point>();
  let left = 0;
  for (const col of columns) {
    const width = Math.max(...col.map((id) => size.get(id)!.w));
    const x = left + width / 2;
    for (const id of col) {
      const box = size.get(id)!;
      const kids = children.get(id);
      if (!kids) {
        positions.set(id, { x, y: y.get(id)! + box.h / 2 });
        continue;
      }
      const first = y.get(id)! + GROUP_LABEL + GROUP_PADDING + NODE_HEIGHT / 2;
      kids.forEach((kid, i) =>
        positions.set(kid, { x, y: first + i * CHILD_STEP }),
      );
      positions.set(id, { x, y: first + ((kids.length - 1) * CHILD_STEP) / 2 });
    }
    left += width + COLUMN_GAP;
  }
  return positions;
}
