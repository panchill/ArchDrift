import { describe, expect, it } from "vitest";
import { calmPatch, calmSnippet } from "../src/calmSnippet";
import raw from "../public/mocks/analysis.json";
import model from "../../examples/opentelemetry-demo.architecture.json";
import type { Analysis } from "../src/types";
const analysis = raw as Analysis, nodes = new Map(analysis.nodes.map(n => [n.node.id, n]));
const edge = analysis.edges.find(e => e.status === "unexpected")!;
describe("CALM relationship proposal", () => {
  it("uses owner IDs and endpoint interfaces", () => {
    const snippet = JSON.parse(calmSnippet(edge, nodes) as string);
    expect(snippet["relationship-type"].connects.source).toEqual({ node: "checkout", interfaces: [nodes.get(edge.source)!.calmInterfaceId] });
    expect(snippet["relationship-type"].connects.destination).toEqual({ node: "email", interfaces: [nodes.get(edge.target)!.calmInterfaceId] });
    expect(snippet.metadata.archdrift.type).toBe("http_call");
    expect(model.relationships.find(r => r["unique-id"] === snippet["unique-id"])).toMatchObject(snippet);
  });
  it("omits interfaces on service-level calls", () => {
    const snippet = JSON.parse(calmSnippet({ ...edge, source: "service:checkout", target: "service:email" }, nodes) as string);
    expect(snippet["relationship-type"].connects.source).toEqual({ node: "checkout" });
    expect(snippet["unique-id"]).toBe("checkout--to--email");
  });
  it("uses the endpoint ID once for publish", () => {
    const publish = analysis.edges.find(e => e.type === "publish")!;
    const snippet = JSON.parse(calmSnippet(publish, nodes) as string);
    expect(snippet["unique-id"]).toBe("checkout--post-oteldemo-CheckoutService-PlaceOrder--to--orders-topic");
    expect(model.relationships.find(r => r["unique-id"] === snippet["unique-id"])).toMatchObject(snippet);
  });
  it("does not invent IDs for unknown nodes", () => {
    const missing = new Map(nodes); missing.set("service:email", { ...nodes.get("service:email")!, calmNodeId: undefined });
    expect(calmSnippet(edge, missing)).toEqual({ missing: "Email" });
  });
  it("keeps topic → service direction for consume", () => {
    const consume = analysis.edges.find(e => e.type === "consume")!;
    const snippet = JSON.parse(calmSnippet(consume, nodes) as string);
    expect(snippet["relationship-type"].connects.source.node).toBe(nodes.get(consume.source)?.calmNodeId);
    expect(snippet.metadata.archdrift.type).toBe("consume");
  });
});
describe("CALM patch for unexpected edges", () => {
  it("is the bare relationship when both ends are in the model", () => {
    const patch = calmPatch(edge, nodes);
    expect(patch.missing).toEqual([]);
    expect(patch.text).toBe(calmSnippet(edge, nodes));
  });
  it("adds a missing service with the called interface and links to it", () => {
    const missing = new Map(nodes);
    missing.set("service:email", { ...nodes.get("service:email")!, calmNodeId: undefined });
    missing.set(edge.target, { ...nodes.get(edge.target)!, calmInterfaceId: undefined });
    const patch = calmPatch(edge, missing);
    expect(patch.missing).toEqual([{ label: "Email", kind: "Сервиса" }]);
    const { nodes: added, relationships } = JSON.parse(patch.text);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ "unique-id": "email", "node-type": "service", name: "Email", metadata: { archdrift: { serviceName: "email" } } });
    const iface = added[0].interfaces[0];
    expect(iface.metadata.archdrift).toEqual({ method: "POST", route: "/send_order_confirmation" });
    expect(relationships[0]["relationship-type"].connects.destination).toEqual({ node: "email", interfaces: [iface["unique-id"]] });
    expect(relationships[0]["relationship-type"].connects.source.node).toBe("checkout");
  });
});
