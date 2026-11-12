import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab, toggleTabFocusMode } from "@codemirror/commands";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { autocompletion } from "@codemirror/autocomplete";
import { json } from "@codemirror/lang-json";
import { tags } from "@lezer/highlight";
import { calmCompletion } from "./calmCompletion";

const colors = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--accent)" },
  { tag: tags.string, color: "var(--ok)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--warn)" },
  { tag: tags.punctuation, color: "var(--text-2)" },
]));
export function JsonEditor({ value, disabled, onChange }: {
  value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null);
  const callback = useRef(onChange), editable = useRef(new Compartment());
  useEffect(() => { callback.current = onChange; }, [onChange]);
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!, doc: value,
      extensions: [basicSetup, json(), colors, indentUnit.of("  "), EditorState.tabSize.of(2),
        keymap.of([indentWithTab, { key: "Ctrl-m", run: toggleTabFocusMode }]),
        autocompletion({ override: [calmCompletion] }),
        editable.current.of([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]),
        EditorView.contentAttributes.of({ "aria-label": "JSON модели", "aria-describedby": "editor-help", spellcheck: "false" }),
        EditorView.updateListener.of(update => { if (update.docChanged) callback.current(update.state.doc.toString()); }),
      ],
    });
    view.current = editor;
    editor.focus();
    return () => { editor.destroy(); view.current = null; };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]) });
  }, [disabled]);
  return <div ref={host} className="json-editor" />;
}
