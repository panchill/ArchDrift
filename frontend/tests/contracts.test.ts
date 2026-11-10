// @vitest-environment node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import architecture from "../public/mocks/architecture.json";
import rawAnalysis from "../public/mocks/analysis.json";
import type { Analysis } from "../src/types";
import { edgeKey } from "../src/graph";
import core from "./schemas/core.json";
import interfaces from "./schemas/interface.json";
import control from "./schemas/control.json";
import flow from "./schemas/flow.json";

const analysis = rawAnalysis as Analysis;
const demoModel = JSON.parse(
  readFileSync(
    new URL(
      "../../examples/opentelemetry-demo.architecture.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const api = parse(
  readFileSync(new URL("../../backend/api/api.yaml", import.meta.url), "utf8"),
);
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat("int64", { type: "number", validate: Number.isSafeInteger });
ajv.addFormat("double", { type: "number", validate: Number.isFinite });

describe("fixtures conform to the backend contract", () => {
  it("keeps the generated architecture mock up to date without rewriting it", () => {
    execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/generate-architecture-mock.mjs", import.meta.url),
        ),
        "--check",
      ],
      { stdio: "pipe" },
    );
  });
  it("uses the Demo declaration with only the stale checkout → email link removed", () => {
    const expected = structuredClone(demoModel);
    expected.metadata.archdrift.version = architecture.version;
    expected.relationships = expected.relationships.filter(
      (r: (typeof architecture.model.relationships)[number]) => {
        const c = r["relationship-type"].connects;
        return !(
          c.source.node === "checkout" && c.destination.node === "email"
        );
      },
    );
    expect(architecture.model).toEqual(expected);
    expect(analysis.nodes.filter((n) => !n.known)).toHaveLength(1);
    expect(
      analysis.edges.filter((e) => e.status === "indeterminate"),
    ).toHaveLength(2);
    expect(analysis.violations).toHaveLength(1);
    expect(analysis.violations[0].source).toBe(
      "endpoint:checkout:POST:%2Foteldemo.CheckoutService%2FPlaceOrder",
    );
    expect(analysis.violations[0].target).toBe(
      "endpoint:email:POST:%2Fsend_order_confirmation",
    );
  });
  it("assigns statuses consistently with CALM scopes, including service fallbacks", () => {
    const nodes = new Map(analysis.nodes.map((n) => [n.node.id, n]));
    const matches = (
      s: { node: string; interfaces?: string[] },
      id: string,
      fallback: boolean,
    ) => {
      const n = nodes.get(id)!;
      const owner = "parentId" in n.node ? nodes.get(n.node.parentId)! : n;
      return (
        owner.calmNodeId === s.node &&
        (!s.interfaces?.length ||
          s.interfaces.includes(n.calmInterfaceId ?? "") ||
          (fallback && n.node.type === "service"))
      );
    };
    for (const edge of analysis.edges) {
      const matching = (fallback: boolean) =>
        architecture.model.relationships
          .filter((r) => {
            const c = r["relationship-type"].connects;
            return (
              r.metadata.archdrift.type === edge.type &&
              matches(c.source, edge.source, fallback) &&
              matches(c.destination, edge.target, fallback)
            );
          })
          .map((r) => r["unique-id"])
          .sort();
      const full = matching(false);
      expect(edge.matchedRelationshipIds).toEqual(full);
      expect(edge.status).toBe(
        full.length
          ? "declared"
          : matching(true).length
            ? "indeterminate"
            : "unexpected",
      );
    }
  });
  it("requires an expected revision for PUT, allowing zero only in the input", () => {
    const input = ajv.compile({
      $ref: "#/components/schemas/ArchitectureInput",
      components: api.components,
    });
    const response = ajv.compile({
      $ref: "#/components/schemas/Architecture",
      components: api.components,
    });
    for (const version of [0, 1, 42]) {
      const model = {
        ...architecture.model,
        metadata: { archdrift: { version } },
      };
      expect(input(model), JSON.stringify(input.errors)).toBe(true);
      expect(response({ ...architecture, version, model })).toBe(version > 0);
    }
    for (const version of [undefined, null, -1, 1.5, "1"]) {
      const model = {
        ...architecture.model,
        metadata: { archdrift: { version } },
      };
      expect(input(model)).toBe(false);
    }
    for (const metadata of [undefined, {}, { archdrift: {} }]) {
      expect(input({ ...architecture.model, metadata })).toBe(false);
    }
    expect(architecture.version).toBe(
      architecture.model.metadata.archdrift.version,
    );
    expect(analysis.architectureVersion).toBe(architecture.version);
  });
  it("documents conflicts for both first creation and later updates", () => {
    const conflict =
      api.paths["/api/v1/architecture"].put.responses["409"].content[
        "application/json"
      ];
    const validate = ajv.compile({
      ...conflict.schema,
      components: api.components,
    });
    expect(validate(conflict.example), JSON.stringify(validate.errors)).toBe(
      true,
    );
    expect(validate({ ...conflict.example, currentVersion: 0 })).toBe(true);
    expect(validate({ ...conflict.example, currentVersion: -1 })).toBe(false);
  });
  it.each([
    ["Architecture", architecture],
    ["Analysis", analysis],
    ["ArchitectureInput", demoModel],
  ])("%s matches OpenAPI schemas", (name, data) => {
    const validate = ajv.compile({
      $ref: `#/components/schemas/${name}`,
      components: api.components,
    });
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  });
  it("CALM nodes and relationships validate against official CALM 1.2 schemas", () => {
    const calmAjv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(calmAjv);
    [core, interfaces, control, flow].forEach((schema) =>
      calmAjv.addSchema(schema),
    );
    const validate = calmAjv.getSchema(core.$id)!;
    expect(validate(architecture.model), JSON.stringify(validate.errors)).toBe(
      true,
    );
    expect(validate(demoModel), JSON.stringify(validate.errors)).toBe(true);
    const broken = structuredClone(architecture.model);
    (broken.nodes[0] as Record<string, unknown>).name = 42;
    expect(validate(broken)).toBe(false);
  });
  it("every CALM selector resolves, including interfaces and worker ownership", () => {
    const nodes = architecture.model.nodes;
    const nodeIds = new Set(nodes.map((n) => n["unique-id"]));
    expect(nodeIds.size).toBe(nodes.length);
    const owners: string[] = [];
    for (const relationship of architecture.model.relationships) {
      const kind = relationship[
        "relationship-type"
      ] as (typeof relationship)["relationship-type"] & {
        "composed-of"?: { container: string; nodes: string[] };
      };
      if (kind["composed-of"]) {
        expect(nodeIds.has(kind["composed-of"].container)).toBe(true);
        owners.push(...kind["composed-of"].nodes);
      }
      if (kind.connects)
        for (const selector of [
          kind.connects.source,
          kind.connects.destination,
        ]) {
          const node = nodes.find((n) => n["unique-id"] === selector.node)!;
          expect(node).toBeDefined();
          for (const id of selector.interfaces ?? [])
            expect(node.interfaces?.some((i) => i["unique-id"] === id)).toBe(
              true,
            );
        }
    }
    for (const worker of nodes.filter((n) => n["node-type"] === "worker")) {
      expect(owners.filter((id) => id === worker["unique-id"])).toHaveLength(1);
    }
  });
  it("all observed references, DB operations, evidence and violations are consistent", () => {
    const ids = new Set(analysis.nodes.map((n) => n.node.id));
    const encode = (value: string) =>
      encodeURIComponent(value).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      );
    for (const { node } of analysis.nodes) {
      const parts =
        node.type === "service"
          ? ["service", node.serviceName]
          : node.type === "endpoint"
            ? [
                "endpoint",
                decodeURIComponent(node.parentId.slice(8)),
                node.method,
                node.route,
              ]
            : node.type === "postgres_database"
              ? ["postgres", node.instance, node.database]
              : node.type === "kafka_topic"
                ? ["kafka", node.cluster, node.topic]
                : [
                    "worker",
                    decodeURIComponent(node.parentId.slice(8)),
                    node.workerName,
                  ];
      expect(node.id).toBe(parts.map(encode).join(":"));
    }
    const relationshipIds = new Set(
      architecture.model.relationships
        .filter((r) => r["relationship-type"].connects)
        .map((r) => r["unique-id"]),
    );
    for (const edge of analysis.edges) {
      expect(ids.has(edge.source) && ids.has(edge.target)).toBe(true);
      expect(!!edge.dbOperation).toBe(edge.type === "db_query");
      expect(edge.errorOperations).toBeLessThanOrEqual(edge.observedOperations);
      expect(edge.matchedRelationshipIds.length > 0).toBe(
        edge.status === "declared",
      );
      edge.matchedRelationshipIds.forEach((id) =>
        expect(relationshipIds.has(id)).toBe(true),
      );
      expect(Date.parse(edge.firstSeenAt)).toBeGreaterThanOrEqual(
        Date.parse(analysis.from),
      );
      expect(Date.parse(edge.lastSeenAt)).toBeLessThan(Date.parse(analysis.to));
    }
    const unexpected = analysis.edges.filter((e) => e.status === "unexpected");
    expect(analysis.violations).toHaveLength(unexpected.length);
    analysis.violations.forEach((v) =>
      expect(
        unexpected.some(
          (e) =>
            edgeKey(e) === edgeKey({ ...v, type: v.edgeType }) &&
            e.exampleTraceId === v.exampleTraceId,
        ),
      ).toBe(true),
    );
    expect(new Set(analysis.edges.map(edgeKey)).size).toBe(
      analysis.edges.length,
    );
    expect(new Set(analysis.edges.map((e) => e.status))).toEqual(
      new Set(["declared", "unexpected", "indeterminate"]),
    );
  });
});
