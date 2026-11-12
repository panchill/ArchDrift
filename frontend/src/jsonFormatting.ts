import type { ChangeSpec } from "@codemirror/state";

// Replace whitespace between tokens instead of the whole document, so CodeMirror
// can map the selection and the visible line to the same JSON after formatting.
export function jsonFormattingChanges(before: string, after: string): ChangeSpec[] {
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g;
  const oldTokens = [...before.matchAll(tokens)], newTokens = [...after.matchAll(tokens)];
  if (oldTokens.length !== newTokens.length) return [{ from: 0, to: before.length, insert: after }];
  const changes: ChangeSpec[] = [];
  let oldEnd = 0, newEnd = 0;
  const replace = (from: number, to: number, insert: string) => {
    if (before.slice(from, to) !== insert) changes.push({ from, to, insert });
  };
  oldTokens.forEach((token, index) => {
    const next = newTokens[index];
    replace(oldEnd, token.index, after.slice(newEnd, next.index));
    replace(token.index, token.index + token[0].length, next[0]);
    oldEnd = token.index + token[0].length;
    newEnd = next.index + next[0].length;
  });
  replace(oldEnd, before.length, after.slice(newEnd));
  return changes;
}
