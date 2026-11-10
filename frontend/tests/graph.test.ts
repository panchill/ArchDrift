import { describe, expect, it } from "vitest";
import type { NodeSingular } from "cytoscape";
import fixture from "../public/mocks/analysis.json";
import type { Analysis, Edge } from "../src/types";
import { buildGraph, graphElements, edgeKey } from "../src/graph";
import { createGraph, zoomAtCenter } from "../src/GraphCanvas";
import { architecturePositions, CHILD_STEP } from "../src/layout";

const analysis = fixture as Analysis;
describe("graph transformation", () => {
  it("keeps all detailed nodes, typed operations and canonical identities", () => {
    const graph = buildGraph(analysis, "details");
    expect(graph.nodes).toHaveLength(87);
    expect(graph.edges).toHaveLength(64);
    expect(new Set(graphElements(graph).map((e) => e.data.id)).size).toBe(151);
    const db = graph.edges.filter(
      (e) =>
        e.source === "service:accounting" &&
        e.target === "postgres:astronomy-db:astronomy_db",
    );
    expect(db.map((e) => e.dbOperation).sort()).toEqual(["INSERT", "SELECT"]);
  });
  it("collapses Demo endpoints while retaining PostgreSQL and Kafka", () => {
    const graph = buildGraph(analysis, "services");
    expect(graph.nodes).toHaveLength(25);
    expect(graph.nodes.some((n) => "parentId" in n.node)).toBe(false);
    expect(
      buildGraph(analysis, "details").nodes.find(
        (n) => n.node.id === "endpoint:frontend:GET:%2Fapi%2Fexperimental",
      )?.known,
    ).toBe(false);
    expect(
      graph.edges.some(
        (e) =>
          e.source === "kafka:kafka:orders" &&
          e.target === "service:accounting",
      ),
    ).toBe(true);
  });
  it("weights latency by operation counts, combines errors, and preserves original members", () => {
    const graph = buildGraph(analysis, "services");
    const gateway = graph.edges.find(
      (e) =>
        e.source === "service:frontend" &&
        e.target === "service:product-catalog",
    )!;
    expect(gateway.observedOperations).toBe(724);
    expect(gateway.avgDurationMs).toBeCloseTo(42.67237569060774);
    expect(gateway.members).toHaveLength(5);
    expect(gateway.matchedRelationshipIds).toHaveLength(5);
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
      (e) => e.source === "service:checkout" && e.target === "service:payment",
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
    expect(graph.edges).toHaveLength(1);
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
    const graph = buildGraph(
      analysis,
      "services",
      "all",
      " ProductCatalogService ",
    );
    expect(
      graph.nodes.some((n) => n.node.id === "service:product-catalog"),
    ).toBe(true);
    expect(
      graph.nodes.some(
        (n) => n.node.id === "postgres:astronomy-db:astronomy_db",
      ),
    ).toBe(true);
    expect(buildGraph(analysis, "details", "all", "does-not-exist")).toEqual({
      nodes: [],
      edges: [],
    });
  });
  it("never mutates the API snapshot across views or filters", () => {
    const before = JSON.stringify(analysis);
    buildGraph(analysis, "services");
    buildGraph(analysis, "details", "unexpected", "payment");
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
      source: "service:checkout",
      target: "service:checkout",
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
    "does not overlap any peer nodes in %s view",
    (view) => {
      const cy = createGraph(undefined, buildGraph(analysis, view));
      const nodes = cy.nodes().toArray();
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          if (
            nodes[i].isChild() !== nodes[j].isChild() ||
            nodes[i].data("parent") !== nodes[j].data("parent")
          )
            continue;
          const a = nodes[i].boundingBox(),
            b = nodes[j].boundingBox();
          const overlap =
            a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
          expect(overlap, `${nodes[i].id()} overlaps ${nodes[j].id()}`).toBe(
            false,
          );
        }
      }
      const box = cy.elements().boundingBox();
      expect(box.w).toBeLessThan(1500);
      expect(box.h).toBeLessThan(view === "services" ? 700 : 2600);
      const focus =
        view === "details"
          ? cy.edges(".unexpected").connectedNodes().boundingBox()
          : box;
      const laptopFit = Math.min((900 - 128) / focus.w, (540 - 128) / focus.h);
      expect(laptopFit).toBeGreaterThan(view === "details" ? 1 : 0.7);
      cy.destroy();
    },
  );
  it("keeps endpoint rows aligned, stable and inside their parent services", () => {
    const graph = buildGraph(analysis, "details");
    const positions = architecturePositions(graph);
    expect(
      architecturePositions({
        nodes: [...graph.nodes].reverse(),
        edges: [...graph.edges].reverse(),
      }),
    ).toEqual(positions);
    const cy = createGraph(undefined, graph);
    cy.nodes(":parent").forEach((parent) => {
      const children = parent
        .children()
        .sort((a, b) => a.position("y") - b.position("y"));
      for (let i = 1; i < children.length; i++) {
        expect(children[i].position("x")).toBe(children[0].position("x"));
        expect(children[i].position("y") - children[i - 1].position("y")).toBe(
          CHILD_STEP,
        );
      }
    });
    cy.destroy();
  });
  it("zooms around the viewport center and clamps to both limits", () => {
    const cy = createGraph(undefined, buildGraph(analysis, "services"));
    cy.pan({ x: 40, y: -20 });
    const before = {
      x: (cy.width() / 2 - cy.pan().x) / cy.zoom(),
      y: (cy.height() / 2 - cy.pan().y) / cy.zoom(),
    };
    zoomAtCenter(cy, 1.25);
    expect((cy.width() / 2 - cy.pan().x) / cy.zoom()).toBeCloseTo(before.x);
    expect((cy.height() / 2 - cy.pan().y) / cy.zoom()).toBeCloseTo(before.y);
    zoomAtCenter(cy, 999);
    expect(cy.zoom()).toBe(cy.maxZoom());
    zoomAtCenter(cy, 0);
    expect(cy.zoom()).toBe(cy.minZoom());
    cy.destroy();
  });
  it("handles cycles and empty search results without an unstable layout", () => {
    expect(architecturePositions({ nodes: [], edges: [] }).size).toBe(0);
    const graph = buildGraph(analysis, "services");
    graph.edges.push({
      ...graph.edges[0],
      source: "service:payment",
      target: "service:checkout",
      type: "http_call",
    });
    const positions = [...architecturePositions(graph).values()];
    expect(
      positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    ).toBe(true);
  });
  it.each(["services", "details"] as const)(
    "computes finite, separated node positions for the %s layout",
    (view) => {
      const cy = createGraph(undefined, buildGraph(analysis, view));
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
      expect(cy.edges(".unexpected").length).toBe(1);
      cy.destroy();
      expect(cy.destroyed()).toBe(true);
    },
  );
});
