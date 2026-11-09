import { describe, expect, it } from "vitest";
import type { NodeSingular } from "cytoscape";
import fixture from "../public/mocks/analysis.json";
import type { Analysis, Edge } from "../src/types";
import { buildGraph, graphElements, edgeKey } from "../src/graph";
import { createGraph, graphLayout } from "../src/GraphCanvas";

const analysis = fixture as Analysis;
describe("graph transformation", () => {
  it("keeps all detailed nodes, typed operations and canonical identities", () => {
    const graph = buildGraph(analysis, "details");
    expect(graph.nodes).toHaveLength(21);
    expect(graph.edges).toHaveLength(17);
    expect(new Set(graphElements(graph).map((e) => e.data.id)).size).toBe(38);
    const db = graph.edges.filter(
      (e) =>
        e.source.includes("POST:%2Forders") &&
        e.target === "postgres:shop-pg:orders_db",
    );
    expect(db.map((e) => e.dbOperation).sort()).toEqual(["INSERT", "SELECT"]);
  });
  it("collapses endpoints/workers while retaining resources and unknown topics", () => {
    const graph = buildGraph(analysis, "services");
    expect(graph.nodes).toHaveLength(11);
    expect(graph.nodes.some((n) => "parentId" in n.node)).toBe(false);
    expect(
      graph.nodes.find((n) => n.node.id === "kafka:shop-events:orders.debug")
        ?.known,
    ).toBe(false);
    expect(
      graph.edges.some(
        (e) =>
          e.source === "kafka:shop-events:orders.created" &&
          e.target === "service:notifications",
      ),
    ).toBe(true);
  });
  it("weights latency by operation counts, combines errors, and preserves original members", () => {
    const graph = buildGraph(analysis, "services");
    const gateway = graph.edges.find(
      (e) => e.source === "service:gateway" && e.target === "service:orders",
    )!;
    expect(gateway.observedOperations).toBe(222);
    expect(gateway.avgDurationMs).toBeCloseTo((128 * 38 + 94 * 12) / 222);
    expect(gateway.members).toHaveLength(2);
    expect(gateway.matchedRelationshipIds).toHaveLength(2);
  });
  it("keeps a minority violation visible and uses its evidence in the summary", () => {
    const base = analysis.edges.find((e) => e.status === "declared")!;
    const unexpected: Edge = {
      ...base,
      status: "unexpected",
      matchedRelationshipIds: [],
      observedOperations: 1,
      exampleTraceId: "f".repeat(32),
    };
    const grouped = buildGraph(
      { ...analysis, edges: [base, unexpected] },
      "services",
    ).edges[0];
    expect(grouped.status).toBe("unexpected");
    expect(grouped.exampleTraceId).toBe(unexpected.exampleTraceId);
    expect(grouped.statuses).toEqual({
      declared: 1,
      unexpected: 1,
      indeterminate: 0,
    });
  });
  it("does not paint an ambiguous child green after collapsing", () => {
    const edge = buildGraph(analysis, "services").edges.find(
      (e) => e.source === "service:orders" && e.target === "service:payments",
    )!;
    expect(edge.status).toBe("indeterminate");
    expect(edge.statuses).toEqual({
      declared: 1,
      unexpected: 0,
      indeterminate: 1,
    });
  });
  it("filters source edges before aggregation and retains compound parents", () => {
    const graph = buildGraph(analysis, "details", "unexpected");
    expect(graph.edges).toHaveLength(2);
    expect(
      graph.edges.every((e) =>
        e.members.every((m) => m.status === "unexpected"),
      ),
    ).toBe(true);
    for (const { node } of graph.nodes)
      if ("parentId" in node) {
        expect(graph.nodes.some((n) => n.node.id === node.parentId)).toBe(true);
      }
    const cy = createGraph(undefined, graph);
    expect(cy.nodes().filter((n) => n.isChild())).toHaveLength(2);
    cy.destroy();
  });
  it("finds endpoints while in service view and keeps adjacent resources", () => {
    const graph = buildGraph(analysis, "services", "all", " /reservations ");
    expect(graph.nodes.some((n) => n.node.id === "service:inventory")).toBe(
      true,
    );
    expect(
      graph.nodes.some((n) => n.node.id === "postgres:shop-pg:inventory_db"),
    ).toBe(true);
    expect(buildGraph(analysis, "details", "all", "does-not-exist")).toEqual({
      nodes: [],
      edges: [],
    });
  });
  it("never mutates the API snapshot across views or filters", () => {
    const before = JSON.stringify(analysis);
    buildGraph(analysis, "services");
    buildGraph(analysis, "details", "unexpected", "payments");
    expect(JSON.stringify(analysis)).toBe(before);
  });
  it("compares observation timestamps as instants, including timezone offsets", () => {
    const base = analysis.edges[0];
    const a = {
      ...base,
      firstSeenAt: "2026-11-09T23:01:00+03:00",
      lastSeenAt: "2026-11-09T23:02:00+03:00",
    };
    const b = {
      ...base,
      firstSeenAt: "2026-11-09T20:02:00Z",
      lastSeenAt: "2026-11-09T20:03:00Z",
    };
    const edge = buildGraph({ ...analysis, edges: [a, b] }, "services")
      .edges[0];
    expect(edge.firstSeenAt).toBe(a.firstSeenAt);
    expect(edge.lastSeenAt).toBe(b.lastSeenAt);
  });
  it("keeps self calls and collision-safe edge keys", () => {
    const base = analysis.edges[0];
    const self = {
      ...base,
      source: "service:orders",
      target: "service:orders",
    };
    expect(
      buildGraph({ ...analysis, edges: [self] }, "services").edges,
    ).toHaveLength(1);
    expect(edgeKey({ ...base, source: "a:b", target: "c" })).not.toBe(
      edgeKey({ ...base, source: "a", target: "b:c" }),
    );
  });
});

describe("Cytoscape integration", () => {
  it.each(["services", "details"] as const)(
    "computes finite, separated node positions for the %s layout",
    (view) => {
      const cy = createGraph(undefined, buildGraph(analysis, view));
      cy.layout({
        ...graphLayout,
        boundingBox: { x1: 0, y1: 0, w: 1100, h: 600 },
      }).run();
      const positions = cy
        .nodes()
        .filter((n) => !n.isParent())
        .map((n) => (n as NodeSingular).position());
      expect(
        positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      ).toBe(true);
      expect(new Set(positions.map((p) => `${p.x},${p.y}`)).size).toBe(
        positions.length,
      );
      cy.destroy();
    },
  );
  it.each(["services", "details"] as const)(
    "loads the actual %s graph and resolves every edge endpoint",
    (view) => {
      const graph = buildGraph(analysis, view);
      const cy = createGraph(undefined, graph);
      expect(cy.nodes().length).toBe(graph.nodes.length);
      expect(cy.edges().length).toBe(graph.edges.length);
      cy.edges().forEach((edge) => {
        expect(edge.source().length).toBe(1);
        expect(edge.target().length).toBe(1);
      });
      expect(cy.edges(".unexpected").length).toBe(2);
      cy.destroy();
      expect(cy.destroyed()).toBe(true);
    },
  );
});
