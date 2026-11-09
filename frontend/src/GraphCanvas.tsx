import { useEffect, useRef } from "react";
import cytoscape, { type Core, type StylesheetJson } from "cytoscape";
import { graphElements, type DisplayGraph } from "./graph";

const style: StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "background-color": "#eef4f3",
      "border-color": "#83a69e",
      "border-width": 1.5,
      color: "#203b36",
      shape: "round-rectangle",
      width: 130,
      height: 48,
      "font-family": "system-ui",
      "font-size": 12,
      "text-valign": "center",
      "text-halign": "center",
      "text-wrap": "wrap",
      "text-max-width": "115px",
    },
  },
  {
    selector: ":parent",
    style: {
      "background-color": "#f5f8f7",
      "background-opacity": 0.8,
      "text-valign": "top",
      "text-margin-y": -10,
      padding: "24px",
      "font-weight": "bold",
    },
  },
  {
    selector: ".endpoint",
    style: {
      "background-color": "#ffffff",
      "border-color": "#a9b9b5",
      "font-size": 10,
      width: 150,
    },
  },
  {
    selector: ".worker",
    style: { "background-color": "#eaf0fc", "border-color": "#8e9ec4" },
  },
  {
    selector: ".postgres_database",
    style: {
      shape: "barrel",
      "background-color": "#eaf0fa",
      "border-color": "#91a9ce",
      color: "#31496d",
    },
  },
  {
    selector: ".kafka_topic",
    style: {
      shape: "round-hexagon",
      "background-color": "#fff3df",
      "border-color": "#cfac70",
      color: "#755622",
    },
  },
  {
    selector: ".unknown",
    style: {
      "border-color": "#c15645",
      "border-width": 2.5,
      "border-style": "dashed",
    },
  },
  {
    selector: ".unobserved",
    style: { opacity: 0.5, "border-style": "dashed" },
  },
  {
    selector: "edge",
    style: {
      width: 1.8,
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "line-color": "#6c9c8d",
      "target-arrow-color": "#6c9c8d",
      label: "data(label)",
      "font-family": "system-ui",
      "font-size": 9,
      color: "#5c706b",
      "text-background-color": "#fcfdfc",
      "text-background-opacity": 1,
      "text-background-padding": "3px",
      "text-rotation": "autorotate",
    },
  },
  {
    selector: "edge.unexpected",
    style: {
      "line-color": "#c25746",
      "target-arrow-color": "#c25746",
      width: 3,
      color: "#ad4637",
    },
  },
  {
    selector: "edge.indeterminate",
    style: {
      "line-color": "#8a939e",
      "target-arrow-color": "#8a939e",
      "line-style": "dashed",
    },
  },
  {
    selector: ":selected",
    style: {
      "border-color": "#132e27",
      "border-width": 3,
      "line-color": "#132e27",
      "target-arrow-color": "#132e27",
    },
  },
];

export const graphLayout: cytoscape.CoseLayoutOptions = {
  name: "cose",
  animate: false,
  randomize: false,
  nodeRepulsion: () => 140000,
  idealEdgeLength: () => 120,
  componentSpacing: 100,
  padding: 45,
};

export function createGraph(
  container: HTMLElement | undefined,
  graph: DisplayGraph,
): Core {
  return cytoscape({
    container,
    headless: !container,
    styleEnabled: true,
    elements: graphElements(graph),
    style,
    minZoom: 0.15,
    maxZoom: 2.5,
    layout: container ? graphLayout : { name: "preset" },
  });
}

export function GraphCanvas({
  graph,
  selected,
  onSelect,
}: {
  graph: DisplayGraph;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const core = useRef<Core | null>(null);
  useEffect(() => {
    const cy = createGraph(container.current!, graph);
    core.current = cy;
    cy.on("tap", "node, edge", (event) => onSelect(event.target.id()));
    const observer = new ResizeObserver(() => cy.resize());
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      cy.destroy();
      core.current = null;
    };
  }, [graph, onSelect]);
  useEffect(() => {
    const cy = core.current;
    if (!cy) return;
    cy.$(":selected").unselect();
    if (selected) cy.getElementById(selected).select();
  }, [graph, selected]);
  return (
    <div className="canvas-shell">
      <div
        ref={container}
        className="graph-canvas"
        role="img"
        aria-label={`Граф архитектуры: ${graph.nodes.length} узлов, ${graph.edges.length} связей. Для выбора используйте список связей и узлов.`}
      />
      {graph.nodes.length === 0 && (
        <div className="graph-empty">
          Ничего не найдено. Измените поиск или фильтр.
        </div>
      )}
      <div className="canvas-tools" aria-label="Масштаб графа">
        <button
          title="Увеличить"
          aria-label="Увеличить"
          onClick={() => {
            const c = core.current;
            if (c) c.zoom(c.zoom() * 1.2);
          }}
        >
          ＋
        </button>
        <button
          title="Уменьшить"
          aria-label="Уменьшить"
          onClick={() => {
            const c = core.current;
            if (c) c.zoom(c.zoom() / 1.2);
          }}
        >
          −
        </button>
        <button onClick={() => core.current?.fit(undefined, 45)}>
          Вписать
        </button>
      </div>
      <span className="canvas-hint">
        Перетаскивайте узлы · прокрутка для масштаба
      </span>
    </div>
  );
}
