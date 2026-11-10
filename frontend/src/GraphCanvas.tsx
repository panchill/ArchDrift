import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core, type StylesheetJson } from "cytoscape";
import { graphElements, type DisplayGraph } from "./graph";
import { architecturePositions, NODE_WIDTH, NODE_HEIGHT } from "./layout";

const style: StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "background-color": "#ffffff",
      "border-color": "#a7b0ad",
      "border-width": 1.5,
      color: "#21372e",
      shape: "round-rectangle",
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      "font-family": "SFMono-Regular, Consolas, monospace",
      "font-size": 14,
      "text-valign": "center",
      "text-halign": "center",
      "text-wrap": "wrap",
      "text-max-width": "200px",
      "text-overflow-wrap": "anywhere",
    },
  },
  {
    selector: ":parent",
    style: {
      "background-color": "#eef1ee",
      "background-opacity": 1,
      "border-color": "#9aa69d",
      "border-width": 1,
      "text-valign": "top",
      "text-margin-y": -12,
      padding: "18px",
      "font-weight": 600,
    },
  },
  {
    selector: ".endpoint",
    style: {
      "background-color": "#ffffff",
      "border-color": "#d2d9d3",
      "font-size": 13,
      "border-width": 1,
    },
  },
  {
    selector: ".worker",
    style: {
      "background-color": "#ffffff",
      "border-color": "#79918a",
      "border-style": "dashed",
    },
  },
  {
    selector: ".postgres_database",
    style: {
      shape: "barrel",
      "background-color": "#edf1f5",
      "border-color": "#8794a3",
      color: "#344653",
      height: 54,
    },
  },
  {
    selector: ".kafka_topic",
    style: {
      shape: "round-hexagon",
      "background-color": "#f5f1e8",
      "border-color": "#a59778",
      color: "#5b503b",
      height: 54,
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
    style: {
      "background-color": "#f7f7f6",
      "border-color": "#c6ccc8",
      color: "#7b847f",
      "border-style": "dashed",
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.4,
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "line-color": "#81988a",
      "target-arrow-color": "#81988a",
      "arrow-scale": 0.8,
      label: "",
      "font-family": "SFMono-Regular, Consolas, monospace",
      "font-size": 12,
      color: "#42554b",
      "text-background-color": "#fcfdfc",
      "text-background-opacity": 1,
      "text-background-padding": "3px",
      "text-rotation": "none",
      "control-point-step-size": 38,
    },
  },
  {
    selector: "edge.unexpected",
    style: {
      "line-color": "#c25746",
      "target-arrow-color": "#c25746",
      width: 2.5,
      color: "#ad4637",
    },
  },
  { selector: "edge:selected", style: { label: "data(label)", width: 3 } },
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

export function createGraph(
  container: HTMLElement | undefined,
  graph: DisplayGraph,
): Core {
  const positions = architecturePositions(graph);
  return cytoscape({
    container,
    headless: !container,
    styleEnabled: true,
    elements: graphElements(graph).map((element) => ({
      ...element,
      ...(positions.has(element.data.id!)
        ? { position: positions.get(element.data.id!) }
        : {}),
    })),
    style,
    minZoom: 0.05,
    maxZoom: 3,
    layout: { name: "preset", fit: !!container, padding: 36 },
  });
}

export function zoomAtCenter(cy: Core, level: number) {
  cy.zoom({
    level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), level)),
    renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
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
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    const cy = createGraph(container.current!, graph);
    core.current = cy;
    const showZoom = () => setZoom(Math.round(cy.zoom() * 100));
    cy.on("zoom", showZoom);
    showZoom();
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
            if (c) zoomAtCenter(c, c.zoom() * 1.25);
          }}
        >
          ＋
        </button>
        <button
          title="Уменьшить"
          aria-label="Уменьшить"
          onClick={() => {
            const c = core.current;
            if (c) zoomAtCenter(c, c.zoom() / 1.25);
          }}
        >
          −
        </button>
        <button
          aria-label="Сбросить масштаб к 100%"
          title="Масштаб 100%"
          onClick={() => {
            if (core.current) zoomAtCenter(core.current, 1);
          }}
        >
          <output aria-label="Текущий масштаб">{zoom}%</output>
        </button>
        <button onClick={() => core.current?.fit(undefined, 36)}>
          Вписать
        </button>
      </div>
      <span className="canvas-hint">
        Перетаскивайте узлы · прокрутка для масштаба
      </span>
    </div>
  );
}
