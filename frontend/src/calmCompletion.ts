import { snippetCompletion, type CompletionContext } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";

const fields: Record<string, string> = {
  "$schema": '"https://calm.finos.org/release/1.2/meta/calm.json"', nodes: "[]", relationships: "[]",
  "unique-id": '""', "node-type": '"service"', name: '""', description: '""', interfaces: "[]",
  "relationship-type": "{}", connects: "{}", "composed-of": "{}", source: "{}", destination: "{}",
  node: '""', container: '""', protocol: '"HTTP"', metadata: "{}", archdrift: "{}", version: "0",
  serviceName: '""', workerName: '""', method: '"GET"', route: '"/"', instance: '""', database: '""',
  cluster: '""', topic: '""', type: '"http_call"',
};
const values: Record<string, string[]> = {
  "node-type": ["service", "worker", "database", "kafka-topic"],
  type: ["http_call", "db_query", "publish", "consume"],
  method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
  "$schema": ["https://calm.finos.org/release/1.2/meta/calm.json"],
};
export function calmCompletion(context: CompletionContext) {
  const { state, pos } = context, node = syntaxTree(state).resolveInner(pos, -1);
  const quoted = node.name === "PropertyName" || node.name === "String";
  if (quoted && pos === node.to && state.sliceDoc(node.to - 1, node.to) === '"') return null;
  if (node.name === "String") {
    const key = node.parent?.getChild("PropertyName");
    const options = key ? values[state.sliceDoc(key.from + 1, key.to - 1)] : undefined;
    return options ? { from: node.from, to: node.to, options: options.map(value => ({ label: JSON.stringify(value), type: "constant" })) } : null;
  }
  const emptyObject = context.explicit && (node.name === "Object" || node.parent?.name === "Object") && /[{,]\s*$/.test(state.sliceDoc(0, pos));
  if (node.name !== "PropertyName" && !emptyObject) return null;
  const hasValue = quoted && /^\s*:/.test(state.sliceDoc(node.to, node.to + 100));
  return { from: quoted ? node.from : pos, to: quoted ? node.to : pos, options: Object.entries(fields).map(([label, value]) =>
    snippetCompletion(JSON.stringify(label) + (hasValue ? "" : ": ${" + value.replace(/[{}]/g, "\\$&") + "}"), { label: JSON.stringify(label), type: "property" })) };
}
