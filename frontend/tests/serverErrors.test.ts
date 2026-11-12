import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api";
import { resetFailure, shortPath, translate } from "../src/serverErrors";
import type { CalmModel } from "../src/types";
const model = { nodes: [{ "unique-id": "cart", interfaces: [{ "unique-id": "get-cart" }] }], relationships: [{ "unique-id": "checkout-to-emails" }] } as CalmModel;
describe("server errors", () => {
  it("translates known errors and labels their relationship", () => {
    expect(translate([{ field: "/relationships/0/relationship-type/connects/destination/node", message: "unknown node reference" }], model)[0]).toEqual({ place: "Связь checkout-to-emails", path: "relationships[0] → назначение.node", message: "Указанного узла нет в модели. Проверьте ссылку на узел." });
  });
  it("locates the interface and gives a safe Russian fallback", () => {
    expect(translate([{ field: "/nodes/0/interfaces/0", message: "new backend message" }], model)[0]).toMatchObject({ place: "Узел cart, интерфейс get-cart", message: "Не соответствует схеме CALM 1.2." });
  });
  it("translates a reset conflict separately from a lost response", () => {
    expect(resetFailure(new ApiError(409, { code: "architecture_version_conflict", message: "stale", currentVersion: 6 }))).toBe("Модель обновили с другого устройства (сейчас v6). Обновите страницу и повторите");
    expect(resetFailure(new ApiError(400, { code: "validation_error", message: "bad" }))).toBe("Некорректная версия модели. Обновите страницу и повторите.");
    expect(resetFailure(new TypeError("fetch failed"))).toBe("Не удалось сбросить модель. Попробуйте ещё раз");
  });
  it("handles dot/index paths as well as JSON pointers", () => {
    expect(shortPath("nodes[0].interfaces[1].metadata")).toBe("nodes[0].interfaces[1].metadata");
  });
});
