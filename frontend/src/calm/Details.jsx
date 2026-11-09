import React from 'react';
import { relationshipLabel } from './render/relationshipLabel';

export function buildIndex(data) {
  return {
    nodes: new Map((data?.nodes ?? []).map((n) => [n['unique-id'], n])),
    rels: new Map((data?.relationships ?? []).map((r) => [r['unique-id'], r])),
    rules: new Map((data?.metadata?.['access-policy']?.rules ?? []).map((r) => [r.id, r])),
  };
}

// shortcut: only `connects` relationships expose endpoints here; add interacts/composed-of when the schema uses them.
function endpoints(rel) {
  const c = rel?.['relationship-type']?.connects;
  return c ? { source: c.source, destination: c.destination } : null;
}

const show = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));
const nodeName = (index, id) => index.nodes.get(id)?.name ?? id;

export function Tooltip({ index, item }) {
  if (item.kind === 'node') {
    const node = index.nodes.get(item.id);
    if (!node) return null;
    return (
      <>
        <strong>{node.name}</strong> <span className="calm-muted">{node['node-type']}</span>
        {node.description && <div>{node.description}</div>}
      </>
    );
  }
  const rel = index.rels.get(item.id);
  if (!rel) return null;
  const ends = endpoints(rel);
  return (
    <>
      <strong>{relationshipLabel(rel) || rel['unique-id']}</strong>
      {ends && (
        <div className="calm-muted">
          {nodeName(index, ends.source.node)} → {nodeName(index, ends.destination.node)}
        </div>
      )}
      {rel.description && <div>{rel.description}</div>}
    </>
  );
}

function Endpoint({ index, end }) {
  return (
    <>
      {nodeName(index, end.node)}
      {end.interfaces?.length > 0 && <span className="calm-muted"> ({end.interfaces.join(', ')})</span>}
    </>
  );
}

function RelationshipDetails({ index, rel }) {
  const ends = endpoints(rel);
  const { match, ...meta } = rel.metadata ?? {};
  const rule = index.rules.get(meta['policy-rule-id']);
  return (
    <>
      <h3>{rel['unique-id']}</h3>
      {meta.action && <span className={`calm-badge calm-badge-${meta.action}`}>{meta.action}</span>}
      {rel.description && <p>{rel.description}</p>}
      <dl>
        {ends && (
          <>
            <dt>Откуда</dt>
            <dd><Endpoint index={index} end={ends.source} /></dd>
            <dt>Куда</dt>
            <dd><Endpoint index={index} end={ends.destination} /></dd>
          </>
        )}
        {rel.protocol && (
          <>
            <dt>Протокол</dt>
            <dd>{rel.protocol}</dd>
          </>
        )}
        {Object.entries(meta).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{show(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
      {match && (
        <>
          <h4>match</h4>
          <pre>{JSON.stringify(match, null, 2)}</pre>
        </>
      )}
      {rule && (
        <>
          <h4>Правило access-policy</h4>
          <pre>{JSON.stringify(rule, null, 2)}</pre>
        </>
      )}
    </>
  );
}

function NodeDetails({ index, node, onSelect }) {
  const id = node['unique-id'];
  const links = [...index.rels.values()].filter((r) => {
    const e = endpoints(r);
    return e && (e.source.node === id || e.destination.node === id);
  });
  return (
    <>
      <h3>{node.name}</h3>
      <span className="calm-badge">{node['node-type']}</span>
      {node.description && <p>{node.description}</p>}
      {node.interfaces?.length > 0 && (
        <>
          <h4>Интерфейсы</h4>
          <table>
            <tbody>
              {node.interfaces.map(({ 'unique-id': uid, protocol, ...rest }) => (
                <tr key={uid}>
                  <td><code>{uid}</code></td>
                  <td>{protocol}</td>
                  <td>{Object.entries(rest).map(([k, v]) => `${k}=${show(v)}`).join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {links.length > 0 && (
        <>
          <h4>Связи</h4>
          <ul>
            {links.map((r) => {
              const e = endpoints(r);
              const out = e.source.node === id;
              return (
                <li key={r['unique-id']}>
                  <button type="button" className="calm-link" onClick={() => onSelect({ kind: 'rel', id: r['unique-id'] })}>
                    {out ? '→' : '←'} {nodeName(index, out ? e.destination.node : e.source.node)} · {relationshipLabel(r)}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

export function DetailsPanel({ index, item, onSelect }) {
  if (item.kind === 'node') {
    const node = index.nodes.get(item.id);
    return node ? <NodeDetails index={index} node={node} onSelect={onSelect} /> : null;
  }
  const rel = index.rels.get(item.id);
  return rel ? <RelationshipDetails index={index} rel={rel} /> : null;
}
