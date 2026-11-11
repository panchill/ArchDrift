import type { Analysis, Edge, GraphNode } from "./types";

export const plural = (n: number, [one, few, many]: readonly [string, string, string]) =>
  `${n} ${n % 100 >= 11 && n % 100 <= 14 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many}`;
export const WORDS = {
  violations: ["нарушение", "нарушения", "нарушений"], errors: ["ошибка", "ошибки", "ошибок"],
  services: ["сервис", "сервиса", "сервисов"], dbs: ["база данных", "базы данных", "баз данных"],
  topics: ["топик Kafka", "топика Kafka", "топиков Kafka"], links: ["связь", "связи", "связей"],
  endpoints: ["endpoint", "endpoints", "endpoints"], workers: ["воркер", "воркера", "воркеров"],
} as const;
export const shortRoute = (route: string) => route.startsWith("/oteldemo.") ? route.split("/").pop()! : route;
export const windowMinutes = ({ from, to }: Pick<Analysis, "from" | "to">) => Math.max(1, Date.parse(to) - Date.parse(from)) / 60000;
export const perMinute = (ops: number, window: Pick<Analysis, "from" | "to">) => Math.round(ops / windowMinutes(window));
export const clockTime = (date: string) => new Date(date).toLocaleTimeString("ru-RU");
export function reason(edge: Edge, nodes: Map<string, GraphNode>): string {
  const t = nodes.get(edge.target)?.node, s = nodes.get(edge.source)?.node;
  if (t?.type === "service") return `${t.label} не передаёт http.route — непонятно, какой endpoint вызван.`;
  if (s?.type === "service") return `${s.label} не передаёт, из какого endpoint сделан вызов.`;
  return "Не хватает данных, чтобы сопоставить вызов с моделью.";
}
export function callName(edge: Edge, nodes: Map<string, GraphNode>): string {
  const target = nodes.get(edge.target)?.node;
  if (edge.type === "db_query") return edge.dbOperation ?? "OTHER";
  if (edge.type === "http_call") return target?.type === "endpoint" ? `${target.method} ${target.route}` : "без маршрута";
  const topic = nodes.get(edge.type === "publish" ? edge.target : edge.source)?.node;
  return topic?.type === "kafka_topic" ? topic.topic : topic?.label ?? "Kafka";
}
