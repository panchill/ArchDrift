import { describe, expect, it } from "vitest";
import { readModelFile } from "../src/upload";
const file = (text: string, size = text.length) => ({ name: "architecture.json", size, text: async () => text }) as File;
describe("model file format checks", () => {
  it("rejects over 16 MiB before reading", async () => {
    expect(await readModelFile(file("{}", 16 * 1024 * 1024 + 1))).toMatchObject({ ok: false, error: "Файл больше 16 МБ." });
  });
  it("reports the JSON error line", async () => {
    const result = await readModelFile(file('{\n"nodes": [] trailing}'));
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Это не JSON: строка 2/) });
  });
  it("omits the line when the parser gives no position", async () => {
    expect(await readModelFile(file("broken"))).toMatchObject({ ok: false, error: "Это не JSON. Нужен файл CALM 1.2 в формате JSON." });
  });
  it.each(["null", "[]", "{}", '{"nodes": []}', '{"nodes": {}, "relationships": []}'])("rejects missing arrays: %s", async source => {
    expect(await readModelFile(file(source))).toMatchObject({ ok: false, error: expect.stringContaining("нет списков nodes и relationships") });
  });
  it("leaves semantic validation to the server", async () => {
    const model = { nodes: [null], relationships: [], custom: true };
    expect(await readModelFile(file(JSON.stringify(model)))).toMatchObject({ ok: true, model });
  });
});
