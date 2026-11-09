// Adapted from @finos/calm-docusaurus-plugin's CalmDiagram (Apache-2.0, see ./LICENSE and ./NOTICE):
// renders the SVG directly with the copied renderer instead of the Svelte <calm-diagram> element.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderELKDiagram } from './render/elkRender';
import { buildIndex, DetailsPanel, Tooltip } from './Details';
import './styles.css';

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;

// Diagram element under the pointer: an edge group or a node group.
function hitOf(target) {
  const el = target?.closest?.('[data-rel-id],[data-node-id]');
  if (!el) return null;
  return el.dataset.relId ? { kind: 'rel', id: el.dataset.relId } : { kind: 'node', id: el.dataset.nodeId };
}

export function CalmDiagram({ data, theme, flow, containers }) {
  const [domTheme, setDomTheme] = useState('light');
  const [svg, setSvg] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, s: 1 });
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const drag = useRef({ active: false, moved: false });
  const fitted = useRef(false);
  const index = useMemo(() => buildIndex(data), [data]);

  // Follow the Docusaurus color mode via html[data-theme].
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDomTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const effectiveTheme = theme ?? domTheme;

  // ELK layout runs in the browser only, so SSR shows the placeholder.
  useEffect(() => {
    let cancelled = false;
    renderELKDiagram(data, { theme: effectiveTheme, flow, containers })
      .then((result) => {
        if (!cancelled) setSvg(result);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [data, effectiveTheme, flow, containers]);

  useEffect(() => {
    fitted.current = false;
  }, [data]);

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    const svgEl = canvasRef.current?.querySelector('svg');
    if (!vp || !svgEl) return;
    const w = svgEl.width.baseVal.value;
    const h = svgEl.height.baseVal.value;
    const s = Math.min(vp.clientWidth / w, vp.clientHeight / h, 1);
    setView({ s, x: (vp.clientWidth - w * s) / 2, y: (vp.clientHeight - h * s) / 2 });
  }, []);

  // Fit once per architecture; theme switches re-render the SVG but keep the user's zoom.
  useEffect(() => {
    if (svg && !fitted.current) {
      fitted.current = true;
      fit();
    }
  }, [svg, fit]);

  const zoomAt = useCallback((factor, cx, cy) => {
    setView((v) => {
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s * factor));
      const k = s / v.s;
      return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);

  // React's onWheel is passive, so preventDefault (stop page scroll) needs a native listener.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoomAt, svg]);

  const zoomCenter = (factor) => {
    const vp = viewportRef.current;
    if (vp) zoomAt(factor, vp.clientWidth / 2, vp.clientHeight / 2);
  };

  // Highlight the focused node's/edge's connections and dim everything else.
  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    const focus = hover ?? selected;
    const lit = new Set();
    root.querySelectorAll('.calm-edge').forEach((g) => {
      const d = g.dataset;
      const on = focus ? (focus.kind === 'rel' ? d.relId === focus.id : d.source === focus.id || d.target === focus.id) : false;
      if (on) lit.add(d.source).add(d.target);
      g.classList.toggle('is-hl', on);
      g.classList.toggle('is-dim', !!focus && !on);
    });
    if (focus?.kind === 'node') lit.add(focus.id);
    root.querySelectorAll('[data-node-id]').forEach((n) => {
      n.classList.toggle('is-dim', !!focus && !lit.has(n.dataset.nodeId));
    });
  }, [hover?.kind, hover?.id, selected, svg]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onPointerDown = (e) => {
    drag.current = { active: true, moved: false, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (d.active) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.moved) {
        setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        setHover(null);
        return;
      }
    }
    const hit = hitOf(e.target);
    if (!hit) {
      if (hover) setHover(null);
      return;
    }
    const r = viewportRef.current.getBoundingClientRect();
    setHover({ ...hit, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const endDrag = () => {
    drag.current.active = false;
  };

  const onClick = (e) => {
    if (drag.current.moved) return;
    setSelected(hitOf(e.target));
  };

  if (error) return <div className="calm-diagram calm-diagram-error">CalmDiagram: {error}</div>;
  if (!svg) return <div className="calm-diagram calm-diagram-placeholder" style={{ minHeight: 200 }} />;

  return (
    <div className="calm-diagram calm-explorer">
      <div
        ref={viewportRef}
        className="calm-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={() => {
          endDrag();
          setHover(null);
        }}
        onClick={onClick}
      >
        <div
          ref={canvasRef}
          className="calm-canvas"
          role="img"
          aria-label="CALM architecture diagram"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="calm-toolbar" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label="Приблизить" onClick={() => zoomCenter(1.25)}>+</button>
          <button type="button" aria-label="Отдалить" onClick={() => zoomCenter(1 / 1.25)}>−</button>
          <button type="button" aria-label="Вписать схему в окно" onClick={fit}>Вписать</button>
        </div>
        {hover && (
          <div className="calm-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
            <Tooltip index={index} item={hover} />
          </div>
        )}
      </div>
      {selected && (
        <aside className="calm-panel" aria-label="Детали элемента схемы">
          <button type="button" className="calm-panel-close" aria-label="Закрыть" onClick={() => setSelected(null)}>
            ×
          </button>
          <DetailsPanel index={index} item={selected} onSelect={setSelected} />
        </aside>
      )}
    </div>
  );
}
