import { describe, expect, it } from "vitest";
import { calmSnippet } from "../src/calmSnippet";
import raw from "../public/mocks/analysis.json";
import model from "../../examples/opentelemetry-demo.architecture.json";
import type { Analysis } from "../src/types";
const analysis = raw as Analysis, nodes = new Map(analysis.nodes.map(n => [n.node.id, n]));
const edge = analysis.edges.find(e => e.status === "unexpected")!;
describe("CALM relationship proposal", () => {
  it("avoids existing relationship IDs without changing the proposed endpoints", () => {
    const proposal = JSON.parse(calmSnippet(edge, nodes) as string), id = proposal["unique-id"];
    expect(JSON.parse(calmSnippet(edge, nodes, [id, `${id}--2`]) as string)).toEqual({ ...proposal, "unique-id": `${id}--3` });
  });
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
