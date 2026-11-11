import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Core, CytoscapeOptions } from "cytoscape";
import App from "../src/App";
import * as api from "../src/api";
import analysis from "../public/mocks/analysis.json";
import architecture from "../public/mocks/architecture.json";
import { serviceEdgeId } from "../src/graph";
import type { Analysis } from "../src/types";
const { cores } = vi.hoisted(() => ({ cores: [] as Core[] }));
// Keep graph elements, events, ELK and React; model upload responses are simulated.
vi.mock("cytoscape", async importOriginal => {
  const module = await importOriginal<{ default: typeof import("cytoscape") }>();
  return { default: (options: CytoscapeOptions) => {
    const core = module.default({ ...options, container: undefined, headless: true, styleEnabled: false, layout: { name: "preset" } });
    cores.push(core); return core;
  } };
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const response = (url: unknown) => json(String(url).includes("/analysis") ? analysis : architecture);
const file = (source = JSON.stringify(architecture.model)) => {
  const value = new File([source], "architecture.json", { type: "application/json" });
  Object.defineProperty(value, "text", { value: async () => source }); return value;
};
let poll: () => Promise<void>;
beforeEach(() => {
  cores.length = 0;
  vi.spyOn(api, "uploadArchitecture").mockResolvedValue(architecture as import("../src/types").Architecture);
  history.replaceState(null, "", "/");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => response(url)));
  const timeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => Promise<void>, ms: number, ...args: unknown[]) => {
    if (ms === 5000) { poll = fn; return 0; }
    return timeout(fn, ms, ...args);
  }) as typeof setTimeout);
});
async function noModel() {
  vi.mocked(fetch).mockImplementation(async () => json({ code: "architecture_not_configured" }, 404));
  render(<App />);
  await screen.findByText("Загрузите модель архитектуры");
}
describe("new architecture flow", () => {
  it("gates graph/issues without a model, including hash navigation", async () => {
    await noModel();
    expect(screen.getByRole("tab", { name: "Схема" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Нарушения" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Модель" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Перетащите architecture.json сюда")).toBeVisible();
    act(() => { location.hash = "/issues"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await waitFor(() => expect(location.hash).toBe("#/model"));
    expect(screen.queryByText(/make model/)).toBeNull();
  });
  it("shows a bad file without making a PUT request", async () => {
    const user = userEvent.setup(); await noModel();
    await user.upload(screen.getByLabelText("Файл CALM"), file("broken"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Файл не загружен");
    expect(screen.getByRole("alert")).toHaveTextContent("Это не JSON");
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== "PUT")).toBe(true);
  });
  it("passes version zero and translates a simulated server validation error", async () => {
    const user = userEvent.setup(); await noModel();
    vi.mocked(api.uploadArchitecture).mockRejectedValue(new api.ApiError(400, { code: "validation_error", message: "Invalid model", details: [{ field: "/relationships/0/relationship-type/connects/destination", message: "unknown node reference" }] }));
    await user.upload(screen.getByLabelText("Файл CALM"), file());
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер не принял модель — 1 ошибка");
    expect(screen.getByRole("alert")).toHaveTextContent("Указанного узла нет в модели");
    expect(api.uploadArchitecture).toHaveBeenCalledWith(architecture.model, 0);
  });
  it("uploads, opens graph, retains the file name but dismisses upload success on leaving", async () => {
    const user = userEvent.setup(); await noModel();
    vi.mocked(fetch).mockImplementation(async url => response(url));
    await user.upload(screen.getByLabelText("Файл CALM"), file());
    expect(await screen.findByRole("heading", { name: "Модель v1" })).toBeVisible();
    expect(await screen.findByText(/Модель загружена\. Сравнение/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Открыть схему" }));
    await screen.findByRole("img");
    await user.click(screen.getByRole("tab", { name: /Модель/ }));
    expect(screen.getByText(/из architecture.json/)).toBeVisible();
    expect(screen.queryByText(/Модель загружена\. Сравнение/)).toBeNull();
    expect(screen.getByText("Связи модели")).toBeVisible();
  });
  it("preserves the current model when a new file is rejected", async () => {
    const user = userEvent.setup(); render(<App />); await screen.findByRole("img");
    await user.click(screen.getByRole("tab", { name: /Модель/ }));
    await user.upload(screen.getByLabelText("Файл CALM"), file("bad"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Файл не загружен");
    expect(screen.getByRole("heading", { name: "Модель v1" })).toBeVisible();
    expect(screen.getByText("Связи модели")).toBeVisible();
  });
  it("notifies on new unexpected edges across model revisions and opens evidence", async () => {
    const user = userEvent.setup();
    const clean = { ...analysis, edges: analysis.edges.map(e => ({ ...e, status: "declared" })) };
    vi.mocked(fetch).mockImplementation(async url => json(String(url).includes("/analysis") ? clean : architecture));
    render(<App />); await screen.findByRole("img");
    expect(screen.getByText(/Все наблюдаемые связи есть в модели/)).toBeVisible();
    expect(screen.queryByText(/Новое нарушение/)).toBeNull();
    vi.mocked(fetch).mockImplementation(async url => json(String(url).includes("/analysis") ? { ...analysis, architectureVersion: 2 } : { ...architecture, version: 2 }));
    await act(async () => { await poll(); });
    expect(await screen.findByText(/Новое нарушение: Checkout → Email/)).toBeVisible();
    expect(screen.getByRole("tab", { name: /Модель v2/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Показать" }));
    const panel = within(await screen.findByLabelText("Детали графа"));
    expect(panel.getByText("Нет в модели")).toBeVisible();
    expect(panel.getByRole("link", { name: /Открыть трейс в Jaeger/ })).toHaveAttribute("href", expect.stringContaining("/jaeger/ui/trace/"));
    await user.click(panel.getByRole("button", { name: "Копировать" }));
    expect(panel.getByRole("button", { name: "Скопировано" })).toBeVisible();
    expect(await navigator.clipboard.readText()).toContain('"connects"');
    await user.click(panel.getByRole("button", { name: "Закрыть панель" }));
    expect(screen.queryByLabelText("Детали графа")).toBeNull();
  });
  it("opens service direction tabs, expands by button, and closes on Esc or background", async () => {
    const user = userEvent.setup(); render(<App />); await screen.findByRole("img");
    act(() => { cores.at(-1)!.getElementById("service:checkout").emit("tap"); });
    const panel = within(screen.getByLabelText("Детали графа"));
    expect(panel.getByText("Сервис")).toBeVisible();
    expect(panel.getByRole("tab", { name: /Куда ходит/ })).toHaveAttribute("aria-selected", "true");
    const cy = cores.at(-1)!;
    act(() => { cy.getElementById("service:checkout").emit("tap"); });
    expect(cores.at(-1)).toBe(cy);
    expect(panel.getByRole("tab", { name: /Куда ходит/ })).toHaveAttribute("aria-selected", "true");
    await user.click(panel.getByRole("button", { name: "Раскрыть endpoints на схеме" }));
    await waitFor(() => expect(cores.at(-1)!.nodes(".endpoint").length).toBeGreaterThan(0));
    await screen.findByRole("img");
    expect(cores.at(-1)!.getElementById("service:email").isParent()).toBe(true);
    await user.click(panel.getByRole("tab", { name: /Кто вызывает/ }));
    await waitFor(() => expect(cores.at(-1)!.getElementById("service:checkout").isParent()).toBe(true));
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Детали графа")).toBeNull();
    act(() => { cores.at(-1)!.getElementById("service:checkout").emit("tap"); });
    expect(screen.getByLabelText("Детали графа")).toBeVisible();
    act(() => { cores.at(-1)!.emit("tap"); });
    expect(screen.queryByLabelText("Детали графа")).toBeNull();
  });
  it("opens Kafka writers first and switches to readers and service directions", async () => {
    const user = userEvent.setup(); render(<App />); await screen.findByRole("img");
    const topic = analysis.nodes.find(n => n.node.type === "kafka_topic")!.node.id;
    act(() => { cores.at(-1)!.getElementById(topic).emit("tap"); });
    const panel = within(screen.getByLabelText("Детали графа"));
    const tabs = panel.getAllByRole("tab");
    expect(tabs[0]).toHaveTextContent("Кто пишет");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveTextContent("Кто читает");
    expect(panel.getByRole("button", { name: /Checkout/ })).toBeVisible();
    await user.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(panel.queryByRole("button", { name: /Checkout/ })).toBeNull();
    expect(panel.getByRole("button", { name: /Accounting/ })).toBeVisible();
    act(() => { cores.at(-1)!.getElementById("service:checkout").emit("tap"); });
    expect(panel.getByRole("tab", { name: /Куда ходит/ })).toHaveAttribute("aria-selected", "true");
  });
  it("lists original problem edges and selects their collapsed edge on the graph", async () => {
    const user = userEvent.setup(); render(<App />); await screen.findByRole("img");
    await user.click(screen.getByRole("tab", { name: /Нарушения/ }));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(analysis.edges.filter(e => e.status !== "declared").length);
    expect(rows[0]).toHaveTextContent("Нет в модели");
    expect(rows[1]).toHaveTextContent("Не хватает данных");
    await user.click(within(rows[0]).getByRole("button", { name: "На схеме" }));
    await screen.findByRole("img");
    expect(screen.getByRole("tab", { name: "Схема" })).toHaveAttribute("aria-selected", "true");
    const edge = (analysis as Analysis).edges.find(e => e.status === "unexpected")!;
    const nodes = new Map((analysis as Analysis).nodes.map(n => [n.node.id, n]));
    expect(cores.at(-1)!.getElementById(serviceEdgeId(edge, nodes)).selected()).toBe(true);
    expect(cores.at(-1)!.nodes(".endpoint")).toHaveLength(0);
  });
  it("keeps data offline and recovers", async () => {
    render(<App />); await screen.findByRole("img");
    vi.mocked(fetch).mockRejectedValue(new TypeError("Network error"));
    await act(async () => { await poll(); });
    expect(screen.getByText("Нет связи с сервером, пробуем снова")).toBeVisible();
    expect(screen.getByRole("img")).toBeVisible();
    vi.mocked(fetch).mockImplementation(async url => response(url));
    await act(async () => { await poll(); });
    expect(screen.queryByText("Нет связи с сервером, пробуем снова")).toBeNull();
  });
  it("routes multiple new violations to their filter and removes resolved notifications", async () => {
    const user = userEvent.setup();
    const clean = { ...analysis, edges: analysis.edges.map(e => ({ ...e, status: "declared" })) };
    vi.mocked(fetch).mockImplementation(async url => json(String(url).includes("/analysis") ? clean : architecture));
    render(<App />); await screen.findByRole("img");
    const changed = { ...analysis, edges: analysis.edges.map((e, i) => ({ ...e, status: i < 2 ? "unexpected" : "declared" })) };
    vi.mocked(fetch).mockImplementation(async url => json(String(url).includes("/analysis") ? changed : architecture));
    await act(async () => { await poll(); });
    expect(screen.getByText(/Новые нарушения: 2/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Показать" }));
    expect(screen.getByRole("tab", { name: /Нарушения/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /Нет в модели 2/ })).toHaveAttribute("aria-pressed", "true");
    vi.mocked(fetch).mockImplementation(async url => json(String(url).includes("/analysis") ? clean : architecture));
    await act(async () => { await poll(); });
    vi.mocked(fetch).mockImplementation(async url => json(String(url).includes("/analysis") ? changed : architecture));
    await act(async () => { await poll(); });
    expect(screen.getByText(/Новые нарушения: 2/)).toBeVisible();
    vi.mocked(fetch).mockImplementation(async url => json(String(url).includes("/analysis") ? clean : architecture));
    await act(async () => { await poll(); });
    expect(screen.queryByText(/Новые нарушения/)).toBeNull();
  });
  it("returns to model upload if analysis reports a removed model", async () => {
    render(<App />); await screen.findByRole("img");
    vi.mocked(fetch).mockResolvedValue(json({ code: "architecture_not_configured" }, 409));
    await act(async () => { await poll(); });
    expect(screen.getByText("Загрузите модель архитектуры")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Схема" })).toBeDisabled();
  });
  it("fits expanded endpoints and toggles them with double click", async () => {
    render(<App />); await screen.findByRole("img");
    act(() => { cores.at(-1)!.getElementById("service:checkout").emit("dbltap"); });
    await waitFor(() => expect(cores.at(-1)!.nodes(".endpoint").length).toBeGreaterThan(0));
    const expanded = cores.at(-1)!;
    const animate = vi.spyOn(expanded, "animate");
    await waitFor(() => expect(animate).toHaveBeenCalledWith(expect.objectContaining({ fit: expect.objectContaining({ padding: 64 }) }), expect.anything()), { timeout: 2000 });
    act(() => { expanded.getElementById("service:checkout").emit("dbltap"); });
    await waitFor(() => expect(cores.at(-1)!.nodes(".endpoint")).toHaveLength(0));
  });
  it("retries initial errors and aborts requests on unmount", async () => {
    const user = userEvent.setup(); vi.mocked(fetch).mockResolvedValue(json({}, 503));
    const { unmount } = render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить данные");
    vi.mocked(fetch).mockImplementation(async url => response(url));
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    await screen.findByRole("img");
    const cy = cores.at(-1)!, signals = vi.mocked(fetch).mock.calls.map(([, init]) => init?.signal);
    unmount(); expect(cy.destroyed()).toBe(true);
    expect(signals.every(s => s?.aborted)).toBe(true);
  });
  it("searches with /, filters problems, supports theme and omits removed UI text", async () => {
    const user = userEvent.setup(); render(<App />); await screen.findByRole("img");
    await user.keyboard("/"); expect(screen.getByRole("searchbox")).toHaveFocus();
    await user.type(screen.getByRole("searchbox"), "nonexistent-service");
    expect(await screen.findByText(/Ничего не найдено/)).toBeVisible();
    await user.clear(screen.getByRole("searchbox"));
    await user.click(screen.getByRole("button", { name: "Только проблемные" }));
    await screen.findByRole("img");
    expect(cores.at(-1)!.edges().every(e => e.data("status") !== "declared")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Переключить тему" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.body.textContent).not.toMatch(/Обновлено|Последние|спанов|Телеметрия неполная|Endpoints и воркеры|Канонический ID|CALM ID/);
  });
});
