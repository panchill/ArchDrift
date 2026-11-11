import { describe, expect, it } from "vitest";
import { perMinute, plural, reason, shortRoute, WORDS } from "../src/text";
import type { Edge, GraphNode } from "../src/types";
describe("UI text", () => {
  it.each([[1, "нарушение"], [2, "нарушения"], [5, "нарушений"], [11, "нарушений"], [21, "нарушение"], [22, "нарушения"]])("declines %i", (n, word) => expect(plural(Number(n), WORDS.violations)).toBe(`${n} ${word}`));
  it("shortens gRPC only", () => {
    expect(shortRoute("/oteldemo.CheckoutService/PlaceOrder")).toBe("PlaceOrder");
    expect(shortRoute("/api/cart")).toBe("/api/cart");
  });
  it.each([[30, 684], [60, 342], [300, 68], [600, 34]])("uses the %i-second analysis window", (seconds, expected) => {
    expect(perMinute(342, { from: "2026-11-10T10:00:00Z", to: new Date(Date.parse("2026-11-10T10:00:00Z") + seconds * 1000).toISOString() })).toBe(expected);
  });
  it("explains target fallback, source fallback and other missing evidence", () => {
    const nodes = new Map<string, GraphNode>([["s", { node: { id: "s", type: "service", label: "Payment", serviceName: "payment" }, known: true, observed: true }]]);
    expect(reason({ source: "e", target: "s" } as Edge, nodes)).toContain("Payment не передаёт http.route");
    expect(reason({ source: "s", target: "e" } as Edge, nodes)).toContain("Payment не передаёт, из какого endpoint");
    expect(reason({ source: "e", target: "e" } as Edge, nodes)).toBe("Не хватает данных, чтобы сопоставить вызов с моделью.");
  });
});
