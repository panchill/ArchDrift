import { describe, expect, it } from "vitest";
import { shortPath, translate } from "../src/serverErrors";
import type { CalmModel } from "../src/types";
const model = { nodes: [{ "unique-id": "cart", interfaces: [{ "unique-id": "get-cart" }] }], relationships: [{ "unique-id": "checkout-to-emails" }] } as CalmModel;
describe("server errors", () => {
  it("translates known errors and labels their relationship", () => {
    expect(translate([{ field: "/relationships/0/relationship-type/connects/destination/node", message: "unknown node reference" }], model)[0]).toEqual({ place: "Связь checkout-to-emails", path: "relationships[0] → назначение.node", message: "Указанного узла нет в модели. Проверьте ссылку на узел." });
  });
  it("locates the interface and gives a safe Russian fallback", () => {
    expect(translate([{ field: "/nodes/0/interfaces/0", message: "new backend message" }], model)[0]).toMatchObject({ place: "Узел cart, интерфейс get-cart", message: "Не соответствует схеме CALM 1.2." });
  });
  it("handles dot/index paths as well as JSON pointers", () => {
    expect(shortPath("nodes[0].interfaces[1].metadata")).toBe("nodes[0].interfaces[1].metadata");
  });
});
