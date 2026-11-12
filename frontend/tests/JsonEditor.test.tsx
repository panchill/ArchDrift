import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { acceptCompletion, currentCompletions, setSelectedCompletion, startCompletion } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import { JsonEditor } from "../src/JsonEditor";

const initial = '{\n  "nodes": [],\n  "relationships": []\n}';
const editor = () => EditorView.findFromDOM(screen.getByLabelText("JSON модели"))!;
function Host({ source = initial }: { source?: string }) {
  const [value, setValue] = useState(source);
  return <JsonEditor value={value} disabled={false} onChange={setValue} />;
}
it.each([false, true])("indents a selected block with Tab and reverses it with Shift+Tab (backwards: %s)", backwards => {
  render(<Host />);
  const view = editor(), end = view.state.doc.length;
  act(() => view.dispatch({ selection: { anchor: backwards ? end : 0, head: backwards ? 0 : end } }));
  fireEvent.keyDown(view.contentDOM, { key: "Tab" });
  const indented = initial.split("\n").map(line => "  " + line).join("\n");
  expect(view.state.doc.toString()).toBe(indented);
  expect(view.state.selection.main.empty).toBe(false);
  act(() => { undo(view); });
  expect(view.state.doc.toString()).toBe(initial);
  act(() => { redo(view); });
  expect(view.state.doc.toString()).toBe(indented);
  fireEvent.keyDown(view.contentDOM, { key: "Tab", shiftKey: true });
  expect(view.state.doc.toString()).toBe(initial);
  expect(view.dom.querySelector(".cm-lineNumbers")).not.toBeNull();
  expect(view.contentDOM.querySelector(".cm-line span[class]")).not.toBeNull();
});
it("keeps external formatting undoable and blocks edits while saving", () => {
  const onChange = vi.fn();
  const { rerender } = render(<JsonEditor value={initial} disabled={false} onChange={onChange} />);
  const compact = JSON.stringify(JSON.parse(initial));
  rerender(<JsonEditor value={compact} disabled={false} onChange={onChange} />);
  expect(editor().state.doc.toString()).toBe(compact);
  act(() => { undo(editor()); });
  expect(editor().state.doc.toString()).toBe(initial);
  rerender(<JsonEditor value={initial} disabled={true} onChange={onChange} />);
  fireEvent.keyDown(editor().contentDOM, { key: "Tab" });
  expect(editor().state.doc.toString()).toBe(initial);
  expect(editor().contentDOM).toHaveAttribute("contenteditable", "false");
});
it.each([
  ['{"nod|"}', '"nodes"', { nodes: [] }],
  ['{"met|"}', '"metadata"', { metadata: {} }],
  ['{"node-type": "ser|"}', '"service"', { "node-type": "service" }],
  ['{"nod|": []}', '"nodes"', { nodes: [] }],
])("completes CALM fields and values without breaking JSON: %s", async (source, label, expected) => {
  const pos = source.indexOf("|");
  render(<Host source={source.replace("|", "")} />);
  act(() => { editor().dispatch({ selection: { anchor: pos } }); startCompletion(editor()); });
  await waitFor(() => expect(currentCompletions(editor().state).map(c => c.label)).toContain(label));
  act(() => editor().dispatch({ effects: setSelectedCompletion(currentCompletions(editor().state).findIndex(c => c.label === label)) }));
  await waitFor(() => { act(() => { expect(acceptCompletion(editor())).toBe(true); }); });
  expect(JSON.parse(editor().state.doc.toString())).toEqual(expected);
});
