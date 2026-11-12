import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Core, CytoscapeOptions } from "cytoscape";
import { GraphCanvas } from "../src/GraphCanvas";
import { buildGraph } from "../src/graph";
import fixture from "../public/mocks/analysis.json";
import type { Analysis } from "../src/types";

const { cores, finish } = vi.hoisted(() => ({ cores: [] as Core[], finish: [] as (() => void)[] }));
vi.mock("cytoscape", async importOriginal => {
  const module = await importOriginal<{ default: typeof import("cytoscape") }>();
  return { default: (options: CytoscapeOptions) => {
    const cy = module.default({ ...options, container: undefined, headless: true, styleEnabled: false });
    vi.spyOn(cy, "container").mockReturnValue(options.container as HTMLElement);
    vi.spyOn(cy, "width").mockReturnValue(1000);
    vi.spyOn(cy, "height").mockReturnValue(700);
    cy.nodes().forEach(node => {
      vi.spyOn(node, "animate").mockImplementation((properties, options) => {
        if ("position" in properties && properties.position) finish.push(() => { node.position(properties.position!); options?.complete?.(); });
        else options?.complete?.();
        return node;
      });
    });
    cores.push(cy);
    return cy;
  } };
});

it("keeps edges hidden until every node finishes moving after a problem filter", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const full = buildGraph(fixture as Analysis, "services");
  const edges = full.edges.filter(e => e.status !== "declared"), keep = new Set(edges.flatMap(e => [e.source, e.target]));
  const filtered = { nodes: full.nodes.filter(n => keep.has(n.node.id)), edges };
  const props = { idle: new Set<string>(), minutes: 5, navigation: 0, selected: null, view: "services" as const, onSelect: vi.fn(), onPositions: vi.fn() };
  const { rerender } = render(<GraphCanvas {...props} graph={full} />);
  await screen.findByRole("img");
  rerender(<GraphCanvas {...props} graph={filtered} />);
  await screen.findByRole("img");
  const cy = cores.at(-1)!;
  expect(finish.length).toBeGreaterThan(0);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  expect(cy.edges(".moving")).toHaveLength(cy.edges().length);
  await act(async () => { finish.splice(0).forEach(done => done()); });
  expect(cy.edges(".moving")).toHaveLength(0);
});
