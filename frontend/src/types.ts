export type NodeType =
  "service" | "endpoint" | "worker" | "postgres_database" | "kafka_topic";
export type EdgeType = "http_call" | "db_query" | "publish" | "consume";
export type EdgeStatus = "declared" | "unexpected" | "indeterminate";
export type DbOperation = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "OTHER";
type BaseNode = { id: string; label: string };
export type NodeDefinition = BaseNode &
  (
    | { type: "service"; serviceName: string }
    | { type: "endpoint"; parentId: string; method: string; route: string }
    | { type: "worker"; parentId: string; workerName: string }
    | { type: "postgres_database"; instance: string; database: string }
    | { type: "kafka_topic"; cluster: string; topic: string }
  );
export interface GraphNode {
  node: NodeDefinition;
  known: boolean;
  observed: boolean;
  calmNodeId?: string;
  calmInterfaceId?: string;
}
export interface Edge {
  source: string;
  target: string;
  type: EdgeType;
  dbOperation?: DbOperation;
  observedOperations: number;
  errorOperations: number;
  avgDurationMs: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: EdgeStatus;
  matchedRelationshipIds: string[];
  exampleTraceId: string;
  exampleSpanId: string;
}
export interface Violation {
  type: "unexpected_edge";
  source: string;
  target: string;
  edgeType: EdgeType;
  dbOperation?: DbOperation;
  message: string;
  exampleTraceId: string;
  exampleSpanId: string;
}
export interface Analysis {
  architectureVersion: number;
  from: string;
  to: string;
  generatedAt: string;
  nodes: GraphNode[];
  edges: Edge[];
  violations: Violation[];
  diagnostics: {
    unmatchedHttpClientSpans: number;
    serviceLevelOperations: number;
    unresolvedResourceSpans: number;
    ignoredMessagingSpans: number;
  };
}

export interface CalmNode {
  "unique-id": string;
  "node-type": string;
  name: string;
  interfaces?: { "unique-id": string; [key: string]: unknown }[];
  [key: string]: unknown;
}
export interface CalmRelationship {
  "unique-id": string;
  "relationship-type": {
    connects?: {
      source: { node: string; interfaces?: string[] };
      destination: { node: string; interfaces?: string[] };
    };
    [key: string]: unknown;
  };
  metadata?: { archdrift?: { type?: EdgeType }; [key: string]: unknown };
  [key: string]: unknown;
}
export interface CalmModel {
  nodes: CalmNode[];
  relationships: CalmRelationship[];
  metadata?: { archdrift?: { version?: number; [key: string]: unknown }; [key: string]: unknown };
  [key: string]: unknown;
}
export interface Architecture { version: number; updatedAt: string; model: CalmModel }
