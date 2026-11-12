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
/** Rare calls must not read as "no traffic": anything above zero but under one per minute is "<1". */
export const formatRate = (perMin: number) => perMin <= 0 ? "0" : perMin < 1 ? "<1" : String(Math.round(perMin));
export const perMinute = (ops: number, window: Pick<Analysis, "from" | "to">) => formatRate(ops / windowMinutes(window));
export const clockTime = (date: string) => new Date(date).toLocaleTimeString("ru-RU");
export const clockShort = (date: string) => new Date(date).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
/** Keeps the tail of a long route (the part that differs) and cuts whole segments from the start. */
export function trimRoute(route: string, max = 34): string {
  if (route.length <= max) return route;
  const parts = route.split("/");
  let tail = "";
  for (let i = parts.length - 1; i > 0; i--) {
    const next = `/${parts[i]}${tail}`;
    if (tail && next.length + 1 > max) break;
    tail = next;
  }
  return `…${tail}`;
}
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
