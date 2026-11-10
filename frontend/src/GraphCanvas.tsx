import { useEffect, useRef, useState } from "react";
import cytoscape, {
  type Core,
  type NodeSingular,
  type SingularElementArgument,
  type StylesheetJson,
} from "cytoscape";
import { graphElements, type DisplayGraph, type NodeMeta } from "./graph";
import {
  GROUP_PADDING,
  hiddenEdge,
  layoutGraph,
  nodeSize,
  type Layout,
  type Point,
  type Route,
} from "./layout";
import type { NodeType } from "./types";

export type Theme = "dark" | "light";
export const palettes = {
  dark: {
    canvas: "#0e0d14",
    card: "#17161f",
    group: "#121119",
    border: "#2b2935",
    text: "#ecebf3",
    text2: "#9a97aa",
    text3: "#66637a",
    accent: "#a78bfa",
    accentBg: "#2a2342",
    ok: "#46c37b",
    bad: "#ff5a5f",
    warn: "#f5a524",
    edge: "#55525f",
  },
  light: {
    canvas: "#f6f5f9",
    card: "#ffffff",
    group: "#efedf5",
    border: "#d9d6e2",
    text: "#1b1a22",
    text2: "#5d5a6e",
    text3: "#7d7a8e",
    accent: "#7c5cf0",
    accentBg: "#ece6ff",
    ok: "#1f9d55",
    bad: "#e5484d",
    warn: "#c27c00",
    edge: "#aeaabc",
  },
};
type Palette = (typeof palettes)["dark"];
const SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'SFMono-Regular', Menlo, Consolas, monospace";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
// shortcut: width by average glyph size, swap for canvas measureText if names clip.
const clip = (s: string, px: number, glyph: number, fromStart = false) => {
  const max = Math.floor(px / glyph);
  if (s.length <= max) return s;
  return fromStart ? `…${s.slice(s.length - max + 1)}` : `${s.slice(0, max - 1)}…`;
};
const text = (
  x: number,
  y: number,
  value: string,
  size: number,
  fill: string,
  extra = "",
) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="${SANS}" ${extra}>${esc(value)}</text>`;

/** Card contents as SVG: Cytoscape labels cannot do icons or several styled lines. */
export function nodeSvg(
  kind: NodeType,
  label: string,
  meta: NodeMeta | undefined,
  known: boolean,
  p: Palette,
) {
  const { w, h } = nodeSize[kind];
  const caption = known ? (meta?.caption ?? "") : "нет в модели";
  const captionFill = known ? p.text3 : p.bad;
  const dash = known ? "" : `stroke-dasharray="5 4"`;
  const stroke = known ? p.border : p.bad;
  let body = "";
  if (kind === "service") {
    const bad = meta?.violations ?? 0;
    body =
      `<rect x="14" y="14" width="26" height="26" rx="7" fill="${p.accentBg}"/>` +
      `<rect x="21" y="21" width="12" height="12" rx="3" fill="none" stroke="${p.accent}" stroke-width="1.8"/>` +
      `<circle cx="27" cy="27" r="2" fill="${p.accent}"/>` +
      text(50, 27, clip(label, w - 62, 8.2), 15, p.text, `font-weight="600"`) +
      text(50, 43, caption, 12, captionFill) +
      (bad
        ? `<circle cx="22" cy="66" r="7" fill="${p.bad}"/>` +
          text(22, 70, "!", 11, "#fff", `font-weight="700" text-anchor="middle"`) +
          text(36, 70, `${bad} ${bad === 1 ? "нарушение" : "нарушения"}`, 12.5, p.bad, `font-weight="500"`)
        : meta?.opsPerMinute
          ? `<circle cx="22" cy="66" r="6.5" fill="none" stroke="${p.ok}" stroke-width="1.5"/>` +
            `<path d="M19 66 l2.2 2.2 l4 -4.4" fill="none" stroke="${p.ok}" stroke-width="1.5"/>` +
            text(36, 70, `${Math.round(meta.opsPerMinute)} опер/мин`, 12.5, p.text2)
          : text(14, 70, "нет вызовов в окне", 12, p.text3)) +
      (meta?.hubs.length
        ? text(w - 14, 70, `→ ${meta.hubs.join(", ")}`, 12, p.text3, `text-anchor="end"`)
        : "");
  } else if (kind === "postgres_database") {
    const r = 11;
    body =
      `<path d="M1 ${r} v${h - 2 * r} a${w / 2 - 1} ${r} 0 0 0 ${w - 2} 0 v-${h - 2 * r}" fill="${p.card}" stroke="${stroke}" stroke-width="1.5" ${dash}/>` +
      `<ellipse cx="${w / 2}" cy="${r}" rx="${w / 2 - 1}" ry="${r - 1}" fill="${p.group}" stroke="${stroke}" stroke-width="1.5" ${dash}/>` +
      text(w / 2, 52, clip(label, w - 16, 8), 14, p.text, `font-weight="600" text-anchor="middle"`) +
      text(w / 2, 70, caption, 12, captionFill, `text-anchor="middle"`);
  } else if (kind === "kafka_topic") {
    const r = 13;
    body =
      `<path d="M${w - r} 1 h-${w - 2 * r} a${r} ${h / 2 - 1} 0 0 0 0 ${h - 2} h${w - 2 * r}" fill="${p.card}" stroke="${stroke}" stroke-width="1.5" ${dash}/>` +
      `<ellipse cx="${w - r}" cy="${h / 2}" rx="${r - 1}" ry="${h / 2 - 1}" fill="${p.group}" stroke="${stroke}" stroke-width="1.5" ${dash}/>` +
      text(w / 2 - 6, 30, clip(label, w - 50, 8), 14, p.text, `font-weight="600" text-anchor="middle"`) +
      text(w / 2 - 6, 47, caption, 12, captionFill, `text-anchor="middle"`);
  } else {
    const [tag, rest] =
      kind === "worker"
        ? ["worker", label]
        : [label.split(" ")[0], label.split(" ").slice(1).join(" ")];
    body =
      `<rect x="10" y="12" width="${tag.length * 7.4 + 10}" height="20" rx="5" fill="${p.accentBg}"/>` +
      `<text x="15" y="26" font-size="11.5" fill="${p.accent}" font-family="${MONO}" font-weight="600">${esc(tag)}</text>` +
      `<text x="${tag.length * 7.4 + 28}" y="26.5" font-size="12.5" fill="${p.text}" font-family="${MONO}">${esc(clip(rest, w - tag.length * 7.4 - 40, 7.6, true))}</text>`;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  )}`;
}

const sized = (kind: NodeType) => ({
  width: nodeSize[kind].w,
  height: nodeSize[kind].h,
});

function styleFor(p: Palette): StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        label: "",
        shape: "round-rectangle",
        "corner-radius": "12px",
        "background-color": p.card,
        "background-image": "data(svg)",
        "background-fit": "none",
        "background-width": "100%",
        "background-height": "100%",
        "border-color": p.border,
        "border-width": 1,
        ...sized("service"),
        "underlay-shape": "round-rectangle",
        "underlay-padding": 0,
        "underlay-opacity": 0,
        "underlay-color": p.accent,
        "transition-property": "opacity",
        "transition-duration": 150,
      },
    },
    { selector: ".endpoint, .worker", style: { ...sized("endpoint"), "corner-radius": "9px" } },
    { selector: ".worker", style: { "border-style": "dashed" } },
    {
      selector: ".postgres_database, .kafka_topic",
      style: { "background-opacity": 0, "border-width": 0 },
    },
    { selector: ".postgres_database", style: sized("postgres_database") },
    { selector: ".kafka_topic", style: sized("kafka_topic") },
    {
      selector: ":parent",
      style: {
        label: "data(label)",
        "background-image": "none",
        "background-color": p.group,
        "border-color": p.border,
        "corner-radius": "14px",
        padding: `${GROUP_PADDING}px`,
        "min-width": "data(minW)",
        "min-height": "data(minH)",
        "min-width-bias-left": "data(left)",
        "min-width-bias-right": "data(right)",
        ...({
          "min-height-bias-top": "data(top)",
          "min-height-bias-bottom": "data(bottom)",
        } as object), // missing from @types
        "text-valign": "top",
        "text-margin-y": -8,
        color: p.text2,
        "font-family": SANS,
        "font-size": 14,
        "font-weight": 600,
      },
    },
    { selector: ".violating", style: { "border-color": p.bad, "border-width": 1.5 } },
    {
      selector: ".unknown.service, .unknown.endpoint, .unknown.worker",
      style: { "border-color": p.bad, "border-style": "dashed", "border-width": 1.5 },
    },
    { selector: ".unobserved", style: { opacity: 0.4 } },
    {
      selector: "node:selected",
      style: { "underlay-opacity": 0.35, "underlay-padding": 5, "border-color": p.text },
    },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "curve-style": "bezier",
        "line-color": p.edge,
        "target-arrow-shape": "triangle",
        "target-arrow-color": p.edge,
        "arrow-scale": 0.9,
        label: "",
        "font-family": MONO,
        "font-size": 11.5,
        "font-weight": 600,
        color: p.text2,
        "text-background-color": p.card,
        "text-background-opacity": 1,
        "text-background-padding": "4px",
        "text-background-shape": "roundrectangle",
        "text-border-color": p.border,
        "text-border-width": 1,
        "text-border-opacity": 1,
        "text-rotation": "none",
        "transition-property": "opacity",
        "transition-duration": 150,
      },
    },
    {
      selector: "edge.routed",
      style: {
        "curve-style": "round-segments",
        ...({ "segment-radius": 10 } as object), // missing from @types
        "edge-distances": "node-position",
        "segment-weights": "data(weights)",
        "segment-distances": "data(distances)",
        "source-endpoint": "data(sourceEndpoint)",
        "target-endpoint": "data(targetEndpoint)",
      },
    },
    { selector: "edge.routed.direct", style: { "curve-style": "straight" } },
    { selector: "edge.declared", style: { opacity: 0.6 } },
    { selector: "edge.hub-edge", style: { display: "none" } },
    { selector: "edge.hub-edge.shown", style: { display: "element" } },
    {
      selector: "edge.indeterminate",
      style: {
        width: 1.8,
        "line-color": p.warn,
        "target-arrow-color": p.warn,
        "line-style": "dashed",
        "line-dash-pattern": [6, 4],
        color: p.warn,
      },
    },
    {
      selector: "edge.unexpected",
      style: {
        width: 3,
        "z-index": 10,
        "line-color": p.bad,
        "target-arrow-color": p.bad,
        "line-style": "dashed",
        "line-dash-pattern": [9, 5],
        "underlay-color": p.bad,
        "underlay-opacity": 0.18,
        "underlay-padding": 5,
        label: "data(label)",
        color: p.bad,
        "text-border-color": p.bad,
      },
    },
    { selector: "edge:selected", style: { label: "data(label)", width: 3 } },
    { selector: ".faded", style: { opacity: 0.15 } },
  ];
}

export function createGraph(
  container: HTMLElement | undefined,
  graph: DisplayGraph,
  options: {
    meta?: Map<string, NodeMeta>;
    theme?: Theme;
    saved?: Map<string, Point>;
    layout?: Layout;
  } = {},
): Core {
  const p = palettes[options.theme ?? "dark"];
  const layout = options.layout ?? {
    positions: new Map(),
    routes: new Map(),
    groups: new Map(),
  };
  const saved = options.saved ?? new Map<string, Point>();
  const positions = new Map([...layout.positions, ...saved]);
  const known = new Map(graph.nodes.map((n) => [n.node.id, n.known]));
  const parents = new Map(
    graph.nodes.map(({ node }) => [
      node.id,
      "parentId" in node ? node.parentId : node.id,
    ]),
  );
  const owner = (id: string) => parents.get(id) ?? id;
  const edges = new Map(graph.edges.map((e) => [e.id, e]));
  const moved = (id: string) => saved.has(id) || saved.has(owner(id));
  const cy = cytoscape({
    container,
    headless: !container,
    styleEnabled: true,
    elements: graphElements(graph).map((element) => {
      const { id, kind, label, source, target } = element.data;
      const meta = options.meta?.get(id!);
      if (source) {
        const route = layout.routes.get(id!);
        const usable =
          route && !moved(source) && !moved(target) && positions.has(source);
        const hub = hiddenEdge(edges.get(id!)!, owner, options.meta);
        return {
          ...element,
          data: usable
            ? {
                ...element.data,
                ...toSegments(positions.get(source)!, positions.get(target)!, route),
              }
            : element.data,
          classes: `${element.classes ?? ""} ${usable ? "routed" : ""} ${
            usable && !route.bends.length ? "direct" : ""
          } ${hub ? "hub-edge" : ""}`,
        };
      }
      const extra = meta?.violations ? "violating" : "";
      const frame = groupFrame(id!, graph, layout);
      return {
        ...element,
        data: {
          ...element.data,
          ...frame,
          svg: nodeSvg(kind, label, meta, known.get(id!)!, p),
        },
        classes: `${element.classes ?? ""} ${extra}`,
        ...(positions.has(id!) ? { position: positions.get(id!) } : {}),
      };
    }),
    style: styleFor(p),
    minZoom: 0.05,
    userZoomingEnabled: false, // trackpad gestures are handled in GraphCanvas
    maxZoom: 3,
    layout: { name: "preset", fit: false },
  });
  return cy;
}

/** Cytoscape shrinks a compound to its children; ELK may make the frame wider
 * (room for edges that end on the group). Stretch it to the ELK frame. */
function groupFrame(id: string, graph: DisplayGraph, layout: Layout) {
  const box = layout.groups.get(id);
  const kids = graph.nodes.filter(
    (n) => "parentId" in n.node && n.node.parentId === id,
  );
  const fit = { minW: 0, minH: 0, left: "50%", right: "50%", top: "50%", bottom: "50%" };
  if (!box || !kids.length) return fit;
  const edges = kids.map(({ node }) => {
    const p = layout.positions.get(node.id) ?? { x: 0, y: 0 };
    const { w, h } = nodeSize[node.type];
    return { x1: p.x - w / 2, x2: p.x + w / 2, y1: p.y - h / 2, y2: p.y + h / 2 };
  });
  const inner = {
    x1: Math.min(...edges.map((e) => e.x1)) - GROUP_PADDING,
    x2: Math.max(...edges.map((e) => e.x2)) + GROUP_PADDING,
    y1: Math.min(...edges.map((e) => e.y1)) - GROUP_PADDING,
    y2: Math.max(...edges.map((e) => e.y2)) + GROUP_PADDING,
  };
  const extraW = box.x2 - box.x1 - (inner.x2 - inner.x1);
  const extraH = box.y2 - box.y1 - (inner.y2 - inner.y1);
  const share = (part: number, total: number) =>
    `${total > 0.5 ? Math.min(100, Math.max(0, (part / total) * 100)) : 50}%`;
  return {
    minW: box.x2 - box.x1,
    minH: box.y2 - box.y1,
    left: share(inner.x1 - box.x1, extraW),
    right: share(box.x2 - inner.x2, extraW),
    top: share(inner.y1 - box.y1, extraH),
    bottom: share(box.y2 - inner.y2, extraH),
  };
}

/** ELK bend points → Cytoscape segments relative to the centre-to-centre line. */
export function toSegments(source: Point, target: Point, route: Route) {
  const vx = target.x - source.x,
    vy = target.y - source.y;
  const len2 = vx * vx + vy * vy || 1;
  const len = Math.sqrt(len2);
  const points = route.bends.map((b) => ({
    w: ((b.x - source.x) * vx + (b.y - source.y) * vy) / len2,
    d: (vx * (b.y - source.y) - vy * (b.x - source.x)) / len,
  }));
  return {
    sourceEndpoint: `${route.start.x - source.x}px ${route.start.y - source.y}px`,
    targetEndpoint: `${route.end.x - target.x}px ${route.end.y - target.y}px`,
    weights: points.map((p) => p.w),
    distances: points.map((p) => p.d),
  };
}

export function fitGraph(cy: Core, initial = false) {
  cy.fit(undefined, 48);
  // The Demo chain is ~10 columns: on first load frame the drift readably instead.
  const drift = cy.edges(".unexpected").connectedNodes().closedNeighborhood();
  if (initial && cy.zoom() < 0.5 && drift.length) cy.fit(drift.nodes(), 64);
  if (cy.zoom() > 1.2) zoomAtCenter(cy, 1.2);
}

export function zoomAtCenter(cy: Core, level: number) {
  cy.zoom({
    level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), level)),
    renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
  });
}

/** Dim everything not adjacent to the element; null clears the focus. */
function focus(cy: Core, element: SingularElementArgument | null) {
  cy.elements().removeClass("faded");
  cy.edges(".shown").removeClass("shown");
  if (!element || !element.length) return;
  if (element.isNode())
    element
      .union(element.descendants())
      .connectedEdges(".hub-edge")
      .addClass("shown");
  let keep = element.isNode()
    ? (element as NodeSingular).closedNeighborhood()
    : element.union(element.connectedNodes());
  keep = keep.union(keep.nodes().parents()).union(keep.nodes().descendants());
  cy.elements().difference(keep).addClass("faded");
}

export function GraphCanvas({
  graph,
  selected,
  onSelect,
  meta,
  theme = "dark",
}: {
  graph: DisplayGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  meta?: Map<string, NodeMeta>;
  theme?: Theme;
}) {
  const container = useRef<HTMLDivElement>(null);
  const core = useRef<Core | null>(null);
  // Same structure → same layout promise: polling never moves nodes.
  const layouts = useRef(new Map<string, Promise<Layout>>());
  // Hand-dragged positions and viewport survive polling; keyed by view.
  const saved = useRef(new Map<string, Map<string, Point>>());
  const viewport = useRef(new Map<string, { nodes: string; zoom: number; pan: Point }>());
  const refit = useRef(() => {});
  const [ready, setReady] = useState<DisplayGraph | null>(null);
  const [nonce, setNonce] = useState(0);
  const [zoom, setZoom] = useState(100);
  const view = graph.nodes.some((n) => "parentId" in n.node) ? "details" : "services";
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    if (!saved.current.has(view)) saved.current.set(view, new Map());
    const store = saved.current.get(view)!;
    const key = [
      view,
      ...graph.nodes.map((n) => n.node.id).sort(),
      ...graph.edges.map((e) => e.id).sort(),
      ...[...(meta ?? [])].filter(([, m]) => m.hub).map(([id]) => id),
    ].join("|");
    if (!layouts.current.has(key)) layouts.current.set(key, layoutGraph(graph, meta));
    layouts.current.get(key)!.then((layout) => {
      if (cancelled || !container.current) return;
      const cy = createGraph(container.current, graph, { meta, theme, saved: store, layout });
      core.current = cy;
      const nodeSet = cy.nodes().map((n) => n.id()).sort().join("|");
      const previous = viewport.current.get(view);
      if (previous?.nodes === nodeSet) cy.viewport({ zoom: previous.zoom, pan: previous.pan });
      else fitGraph(cy, true);
      const showZoom = () => {
        setZoom(Math.round(cy.zoom() * 100));
        viewport.current.set(view, { nodes: nodeSet, zoom: cy.zoom(), pan: { ...cy.pan() } });
      };
      cy.on("viewport", showZoom);
      showZoom();
      cy.on("tap", "node, edge", (event) => onSelect(event.target.id()));
      cy.on("tap", (event) => {
        if (event.target === cy) onSelect(null);
      });
      // A dragged node invalidates the ELK routes of its edges: fall back to straight lines.
      cy.on("grab", "node", (e) =>
        e.target.union(e.target.descendants()).connectedEdges().removeClass("routed"),
      );
      cy.on("dragfree", "node", (e) =>
        e.target
          .union(e.target.descendants())
          .forEach((n: NodeSingular) => {
            if (!n.isParent()) store.set(n.id(), { ...n.position() });
          }),
      );
      // Trackpad: two-finger swipe pans; pinch arrives as wheel with ctrlKey and zooms.
      const element = container.current;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        if (!e.ctrlKey) return cy.panBy({ x: -e.deltaX, y: -e.deltaY });
        const box = element.getBoundingClientRect();
        cy.zoom({
          level: Math.max(
            cy.minZoom(),
            Math.min(cy.maxZoom(), cy.zoom() * Math.exp(-e.deltaY / 100)),
          ),
          renderedPosition: { x: e.clientX - box.left, y: e.clientY - box.top },
        });
      };
      element.addEventListener("wheel", onWheel, { passive: false });
      let frame = 0;
      const red = cy.edges(".unexpected");
      const tick = (t: number) => {
        red.style("line-dash-offset", -t / 40);
        frame = requestAnimationFrame(tick);
      };
      if (red.length) frame = requestAnimationFrame(tick);
      const observer = new ResizeObserver(() => cy.resize());
      observer.observe(element);
      refit.current = () => {
        store.clear();
        viewport.current.delete(view);
        setNonce((n) => n + 1);
      };
      cleanup = () => {
        cancelAnimationFrame(frame);
        element.removeEventListener("wheel", onWheel);
        observer.disconnect();
        cy.destroy();
        core.current = null;
      };
      setReady(graph);
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [graph, onSelect, meta, theme, view, nonce]);
  useEffect(() => {
    const cy = core.current;
    if (!cy || ready !== graph) return;
    cy.$(":selected").unselect();
    const element = selected ? cy.getElementById(selected) : null;
    if (element?.length) {
      element.select();
      cy.animate({ center: { eles: element } }, { duration: 250 });
    }
    focus(cy, element ?? null);
  }, [graph, ready, selected]);
  return (
    <div className="canvas-shell">
      <div
        ref={container}
        className="graph-canvas"
        role={ready === graph ? "img" : undefined}
        aria-label={`Граф архитектуры: ${graph.nodes.length} узлов, ${graph.edges.length} связей. Для выбора используйте список связей и узлов.`}
      />
      {graph.nodes.length === 0 && (
        <div className="graph-empty">
          Ничего не найдено. Измените поиск или фильтр.
        </div>
      )}
      <div className="float canvas-tools" aria-label="Масштаб графа">
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
        <button
          title="Увеличить"
          aria-label="Увеличить"
          onClick={() => {
            const c = core.current;
            if (c) zoomAtCenter(c, c.zoom() * 1.25);
          }}
        >
          +
        </button>
        <button
          title="Пересчитать раскладку и вписать граф"
          onClick={() => refit.current()}
        >
          Вписать
        </button>
      </div>
    </div>
  );
}
