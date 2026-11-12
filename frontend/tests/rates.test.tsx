import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import raw from "../public/mocks/analysis.json";
import architecture from "../public/mocks/architecture.json";
import { buildGraph, nodeMeta } from "../src/graph";
import { ModelTab } from "../src/ModelTab";
import { IssuesTab } from "../src/IssuesTab";
import { Inspector } from "../src/Inspector";
import type { Analysis, Architecture } from "../src/types";

// 197 operations over ten minutes: every view must show 20/min, not 39/min.
const snapshot: Analysis = { ...raw as Analysis, to: "2026-11-10T10:10:00Z", edges: [{
  ...(raw as Analysis).edges.find(e => e.status === "declared")!, observedOperations: 197,
}] };
const nodes = new Map(snapshot.nodes.map(n => [n.node.id, n]));
const edge = buildGraph(snapshot, "services").edges[0];
const model = architecture as Architecture;
const props = { architecture: model, snapshot, nodes, direction: "out" as const, setDirection: vi.fn(), expanded: null, onExpand: vi.fn(), onShow: vi.fn(), onClose: vi.fn(), onModelSaved: vi.fn() };

it("uses the analysis interval in model relationship rows", () => {
  render(<ModelTab architecture={model} snapshot={snapshot} onUploaded={vi.fn()} onGraph={vi.fn()} onReset={vi.fn()} />);
  expect(screen.getByText("20/мин")).toBeVisible();
});
it("uses the analysis interval in issue rows", () => {
  render(<IssuesTab snapshot={{ ...snapshot, edges: [{ ...snapshot.edges[0], status: "unexpected", matchedRelationshipIds: [] }] }} version={1} nodes={nodes} filter="all" setFilter={vi.fn()} onShow={vi.fn()} />);
  expect(screen.getByText("20/мин")).toBeVisible();
});
it("uses the analysis interval in edge facts", () => {
  render(<Inspector {...props} edge={edge} />);
  expect(screen.getByText(/^20 в мин ·/)).toBeVisible();
});
it("keeps service totals and neighbor rates on the same interval", () => {
  render(<Inspector {...props} item={nodes.get(edge.source)} meta={nodeMeta(snapshot).get(edge.source)} />);
  expect(screen.getByText(/20 опер\/мин/)).toBeVisible();
  expect(screen.getByText("20/мин")).toBeVisible();
});
it("shows a declared edge with the model description and no copy actions", () => {
  render(<Inspector {...props} edge={edge} />);
  const relation = model.model.relationships.find(r => r["unique-id"] === edge.matchedRelationshipIds[0])!;
  expect(screen.getByText("Есть в модели")).toBeVisible();
  expect(screen.getByText(`«${relation.description}»`)).toHaveAttribute("title", edge.matchedRelationshipIds.join(", "));
  expect(screen.queryByText("Вызов нужен?")).toBeNull();
  expect(screen.getByRole("link", { name: /Открыть трейс/ })).toBeVisible();
});
it("shows rare calls as <1 per minute", () => {
  const rare = { ...snapshot, edges: [{ ...snapshot.edges[0], observedOperations: 2 }] };
  render(<Inspector {...props} snapshot={rare} edge={buildGraph(rare, "services").edges[0]} />);
  expect(screen.getByText(/^<1 в мин ·/)).toBeVisible();
});
