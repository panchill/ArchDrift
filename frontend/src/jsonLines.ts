// Index field locations in JSON already accepted by JSON.parse; keep original whitespace.
export function jsonLines(source: string) {
  const lines = new Map<string, number>();
  const stack: { path: string; array: boolean; index: number; key?: string }[] = [];
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g;
  let line = 1, offset = 0;
  for (const token of source.matchAll(tokens)) {
    line += source.slice(offset, token.index).split("\n").length - 1;
    offset = token.index + token[0].length;
    const text = token[0], parent = stack.at(-1);
    if (text === "}" || text === "]") { stack.pop(); continue; }
    if (text === ":") continue;
    if (text === ",") { if (parent) { parent.index++; parent.key = undefined; } continue; }
    if (parent && !parent.array && parent.key === undefined) {
      parent.key = String(JSON.parse(text)).replace(/~/g, "~0").replace(/\//g, "~1");
      lines.set(`${parent.path}/${parent.key}`, line);
      continue;
    }
    const path = parent ? `${parent.path}/${parent.array ? parent.index : parent.key}` : "";
    if (!parent || parent.array) lines.set(path, line);
    if (text === "{" || text === "[") stack.push({ path, array: text === "[", index: 0 });
  }
  return (field: string) => {
    let path = field === "/" ? "" : field;
    while (!lines.has(path) && path.includes("/")) path = path.slice(0, path.lastIndexOf("/"));
    // A missing field points to its enclosing object.
    return lines.get(path);
  };
}

export function calmFormatError(line?: number) {
  return `Некорректный формат CALM${line ? ` — строка ${line}` : ""}.`;
}
