import { expect, it } from "vitest";
import { jsonLines } from "../src/jsonLines";
import { parseModel } from "../src/upload";

const source = '{\r\n  "nodes": [\r\n    {"name": "escaped \\"quote\\" and {braces}"},\r\n    {\r\n      "name": "second",\r\n      "metadata": {"a/b~c": null}\r\n    }\r\n  ],\r\n  "relationships": []\r\n}';
it.each([
  ["/nodes/0/name", 3], ["/nodes/1/name", 5], ["/nodes/1/metadata/a~1b~0c", 6],
  ["/nodes/1/missing", 4], ["/relationships", 9], ["/", 1],
])("locates %s in the original JSON, including repeated keys and missing fields", (path, line) => {
  expect(() => JSON.parse(source)).not.toThrow();
  expect(jsonLines(source)(path)).toBe(line);
});
it("locates compact nested arrays without confusing punctuation in strings", () => {
  expect(jsonLines('{"nodes":[[true,false,null,-1.2e3,{"name":"[,]"}]]}')('/nodes/0/4/name')).toBe(1);
});
it("reports the actual line of an invalid CALM array", () => {
  expect(parseModel('{\n "nodes": {},\n "relationships": []\n}')).toEqual({ ok: false, error: "Некорректный формат CALM — строка 2." });
});
it("reports the last line for truncated JSON", () => {
  expect(parseModel('{\n "nodes": [\n')).toEqual({ ok: false, error: "Некорректный JSON — строка 3." });
});
