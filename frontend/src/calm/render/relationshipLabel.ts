// Short edge caption from an ArchDrift relationship's protocol + metadata.
interface LabelSource {
  protocol?: string;
  metadata?: {
    action?: string;
    interaction?: string;
    method?: string;
    route?: string;
    worker?: string;
    match?: { dbOperations?: string[] };
  };
}

export function relationshipLabel(rel: LabelSource): string {
  const m = rel.metadata ?? {};
  let text: string;
  if (m.method && m.route) text = `${m.method} ${m.route}`;
  else if (m.interaction === 'db_query') text = [rel.protocol ?? 'JDBC', ...(m.match?.dbOperations ?? [])].join(' ');
  else if (m.interaction === 'consume' && m.worker) text = `consume · ${m.worker}`;
  else text = m.interaction ?? rel.protocol ?? '';
  return m.action === 'deny' ? `deny · ${text}` : text;
}
