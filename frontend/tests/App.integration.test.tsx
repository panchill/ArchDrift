import { EditorView } from "@codemirror/view";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Core, CytoscapeOptions } from "cytoscape";
import App from "../src/App";
import analysis from "../public/mocks/analysis.json";
import architecture from "../public/mocks/architecture.json";
import { serviceEdgeId } from "../src/graph";
import type { Analysis } from "../src/types";
const { cores } = vi.hoisted(() => ({ cores: [] as Core[] }));
// Keep real graph elements, events, ELK, API adapter and React; replace only rendering.
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
let resizeGraph: () => void;
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  cores.length = 0;
  localStorage.clear();
  history.replaceState(null, "", "/");
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resizeGraph = callback; }
    observe() {} disconnect() {}
  });
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
const editor = () => EditorView.findFromDOM(screen.getByLabelText("JSON модели"))!;
function changeJSON(value: string) {
  act(() => { editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: value } }); });
}
describe("new architecture flow", () => {
  async function openProposal() {
    const user = userEvent.setup(); render(<App />); await screen.findByRole("img");
    const edge = (analysis as Analysis).edges.find(e => e.status === "unexpected")!;
    const nodes = new Map((analysis as Analysis).nodes.map(n => [n.node.id, n]));
    act(() => { cores.at(-1)!.getElementById(serviceEdgeId(edge, nodes)).emit("tap"); });
    return user;
  }
  it("appends the displayed relationship once and refreshes the graph after saving", async () => {
    const user = await openProposal();
    const proposal = JSON.parse(screen.getByLabelText("Детали графа").querySelector("pre")!.textContent!);
    let finish!: (response: Response) => void;
    const put = new Promise<Response>(resolve => { finish = resolve; });
    const clean = { ...analysis, architectureVersion: 2, edges: analysis.edges.map(e => e.status === "unexpected" ? { ...e, status: "declared", matchedRelationshipIds: [proposal["unique-id"]] } : e) };
    vi.mocked(fetch).mockImplementation(async (url, init) => init?.method === "PUT" ? put : json(String(url).includes("/analysis") ? clean : architecture));
    await user.dblClick(screen.getByRole("button", { name: "Добавить в модель" }));
    expect(screen.getByRole("button", { name: "Добавляем…" })).toBeDisabled();
    const puts = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(1);
    const sent = JSON.parse(String(puts[0][1]?.body));
    expect(sent).toEqual({ ...architecture.model, relationships: [...architecture.model.relationships, proposal] });
    await act(async () => { finish(json({ ...architecture, version: 2, model: { ...sent, metadata: { ...sent.metadata, archdrift: { ...sent.metadata.archdrift, version: 2 } } } })); });
    expect(await screen.findByText("Связь добавлена в модель")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Добавить в модель" })).toBeNull());
    expect(screen.getByRole("tab", { name: /Модель v2/ })).toBeVisible();
    expect(within(screen.getByLabelText("Детали графа")).getByText("Есть в модели")).toBeVisible();
  });
  it.each([
    [409, "Модель изменилась"], [400, "Сервер отклонил связь"], [503, "Не удалось добавить связь"],
  ])("preserves the model on add failure %s and never retries automatically", async (status, message) => {
    const user = await openProposal();
    vi.mocked(fetch).mockResolvedValue(json({}, status));
    await user.click(screen.getByRole("button", { name: "Добавить в модель" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Добавить в модель" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: /Модель v1/ })).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });
  it("does not offer adding a relationship with an undeclared node", async () => {
    const missing = { ...analysis, nodes: analysis.nodes.map(n => n.node.id === "service:email" ? { ...n, calmNodeId: undefined } : n) };
    vi.mocked(fetch).mockImplementation(async url => json(String(url).includes("/analysis") ? missing : architecture));
    await openProposal();
    expect(screen.getByText(/сначала добавьте его/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Добавить в модель" })).toBeNull();
  });
  async function editModel() {
    const user = userEvent.setup(); render(<App />); await screen.findByRole("img");
    await user.click(screen.getByRole("tab", { name: /Модель/ }));
    await user.click(screen.getByRole("button", { name: "Редактировать модель" }));
    return user;
  }
  it("formats JSON, cancels edits and saves all fields with the original revision", async () => {
    const user = await editModel();
    const changed = { ...architecture.model, description: "Edited", custom: { keep: true } };
    changeJSON(JSON.stringify(changed));
    await user.click(screen.getByRole("button", { name: "Форматировать JSON" }));
    expect(editor().state.doc.toString()).toBe(JSON.stringify(changed, null, 2));
    await user.click(screen.getByRole("button", { name: "Отменить" }));
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Редактировать модель" }));
    expect(editor().state.doc.toString()).toBe(JSON.stringify(architecture.model, null, 2));
    changeJSON(JSON.stringify(changed));
    const saved = { ...architecture, version: 2, model: { ...changed, metadata: { ...changed.metadata, archdrift: { ...changed.metadata.archdrift, version: 2 } } } };
    vi.mocked(fetch).mockImplementation(async url => json(String(url).includes("/analysis") ? { ...analysis, architectureVersion: 2, edges: [] } : saved));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByRole("heading", { name: "Модель v2" });
    expect(screen.queryByRole("dialog")).toBeNull();
    const puts = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(JSON.parse(String(puts[0][1]?.body))).toEqual({ ...changed, metadata: { ...changed.metadata, archdrift: { ...changed.metadata.archdrift, version: architecture.version } } });
    await user.click(screen.getByRole("tab", { name: "Нарушения" }));
    expect(screen.queryByText("Нет в модели")).toBeNull();
  });
  it.each(["{ broken", "null", '{"nodes": []}'])("keeps invalid JSON without sending it: %s", async source => {
    const user = await editModel();
    changeJSON(source);
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Некорректный (JSON|формат CALM)/);
    expect(editor().state.doc.toString()).toBe(source);
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
  it("preserves the draft across polling and conflicts without retrying a PUT", async () => {
    const user = await editModel();
    const source = JSON.stringify({ ...architecture.model, description: "Draft" });
    changeJSON(source);
    vi.mocked(fetch).mockImplementation(async (url, init) => init?.method === "PUT"
      ? json({ code: "architecture_version_conflict" }, 409)
      : json(String(url).includes("/analysis") ? { ...analysis, architectureVersion: 2 } : { ...architecture, version: 2 }));
    await act(async () => { await poll(); });
    expect(editor().state.doc.toString()).toBe(source);
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Модель уже изменена на сервере");
    expect(editor().state.doc.toString()).toBe(source);
    const puts = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(JSON.parse(String(puts[0][1]?.body)).metadata.archdrift.version).toBe(1);
  });
  it.each([
    [400, { code: "validation_error", details: [{ field: "/nodes/0", message: "unknown node reference" }] }, "Некорректный формат CALM — строка 1."],
    [503, {}, "Сервер временно недоступен"],
  ])("keeps editor content on server error %s", async (status, body, message) => {
    const user = await editModel();
    const source = JSON.stringify(architecture.model);
    changeJSON(source);
    vi.mocked(fetch).mockResolvedValue(json(body, status));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(editor().state.doc.toString()).toBe(source);
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeEnabled();
  });
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
    expect(screen.getByRole("alert")).toHaveTextContent("Некорректный JSON");
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== "PUT")).toBe(true);
  });
  it("sends version zero and translates a server validation error", async () => {
    const user = userEvent.setup(); await noModel();
    vi.mocked(fetch).mockResolvedValue(json({ code: "validation_error", details: [{ field: "/relationships/0/relationship-type/connects/destination", message: "unknown node reference" }] }, 400));
    await user.upload(screen.getByLabelText("Файл CALM"), file());
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер не принял модель — 1 ошибка");
    expect(screen.getByRole("alert")).toHaveTextContent("Указанного узла нет в модели");
    const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]?.body)).metadata.archdrift.version).toBe(0);
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
  it("keeps both ends of a selected edge visible after the inspector shrinks the canvas", async () => {
    render(<App />); await screen.findByRole("img");
    const cy = cores.at(-1)!;
    const edge = (analysis as Analysis).edges.find(e => e.status === "unexpected")!;
    const nodes = new Map((analysis as Analysis).nodes.map(n => [n.node.id, n]));
    const element = cy.getElementById(serviceEdgeId(edge, nodes));
    const box = element.union(element.connectedNodes()).boundingBox();
    const width = vi.spyOn(cy, "width").mockReturnValue(box.w + 200);
    vi.spyOn(cy, "height").mockReturnValue(box.h + 200);
    cy.viewport({ zoom: 1, pan: { x: 100 - box.x1, y: 100 - box.y1 } });
    const animate = vi.spyOn(cy, "animate").mockReturnValue(cy);
    act(() => { element.emit("tap"); });
    expect(screen.getByLabelText("Детали графа")).toBeVisible();
    act(() => resizeGraph());
    expect(animate).not.toHaveBeenCalled();
    width.mockReturnValue(box.w + 80);
    act(() => resizeGraph());
    const { pan, zoom } = animate.mock.calls[0][0];
    expect(box.x1 * Number(zoom) + pan!.x).toBeGreaterThanOrEqual(0);
    expect(box.x2 * Number(zoom) + pan!.x).toBeLessThanOrEqual(cy.width());
    act(() => cy.emit("tap"));
    animate.mockClear();
    act(() => resizeGraph());
    expect(animate).not.toHaveBeenCalled();
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
    expect(screen.getByRole("button", { name: /Нет в модели/ }).querySelector(".status-dot.unexpected")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Не хватает данных/ }).querySelector(".status-dot.indeterminate")).not.toBeNull();
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
    const graph = cores.at(-1)!;
    const input = screen.getByRole("searchbox");
    const highlightedNode = () => graph.nodes(".search-match")[0]?.id();
    await user.type(input, "hipp");
    expect(await screen.findByText("Не найдено")).toBeVisible();
    await user.clear(input);
    await user.type(input, "Shipp");
    expect(await screen.findByText("1 из 1")).toBeVisible();
    expect(graph.getElementById("service:shipping").hasClass("search-match")).toBe(true);
    await user.clear(input);
    await user.type(input, "db");
    expect(highlightedNode()).toBe("postgres:astronomy-db:astronomy_db");
    await user.clear(input);
    await user.type(input, "kafka");
    expect(highlightedNode()).toBe("kafka:kafka:orders");
    await user.clear(input);
    await user.type(input, "Front");
    expect(await screen.findByText("1 из 3")).toBeVisible();
    const first = highlightedNode();
    await user.click(screen.getByRole("button", { name: "Следующее совпадение" }));
    expect(screen.getByText("2 из 3")).toBeVisible();
    expect(highlightedNode()).not.toBe(first);
    await user.click(screen.getByRole("button", { name: "Предыдущее совпадение" }));
    expect(screen.getByText("1 из 3")).toBeVisible();
    expect(highlightedNode()).toBe(first);
    await user.click(input);
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(screen.getByText("3 из 3")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(cores.at(-1)).toBe(graph);
    expect(graph.nodes(".search-match")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Только проблемные" }));
    await screen.findByRole("img");
    expect(cores.at(-1)!.edges().every(e => e.data("status") !== "declared")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Переключить тему" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.body.textContent).not.toMatch(/Обновлено|Последние|спанов|Телеметрия неполная|Endpoints и воркеры|Канонический ID|CALM ID/);
  });
  it("returns to the upload screen after the model is reset", async () => {
    const user = userEvent.setup();
    let gone = false;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (init?.method === "DELETE") { gone = true; return new Response(null, { status: 204 }); }
      if (gone && String(url).includes("architecture")) return json({ code: "architecture_not_configured" }, 404);
      if (gone && String(url).includes("analysis")) return json({ code: "architecture_not_configured" }, 409);
      return response(url);
    });
    render(<App />);
    await screen.findByRole("img");
    await user.click(screen.getByRole("tab", { name: /Модель/ }));
    await user.click(screen.getByRole("button", { name: "Сбросить модель" }));
    await user.click(screen.getByRole("button", { name: "Сбросить" }));
    expect(await screen.findByRole("heading", { name: "Загрузите модель архитектуры" })).toBeVisible();
    expect(screen.getByText("Модель сброшена")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Сбросить модель" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Схема" })).toBeDisabled();
    const deleted = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(String(deleted?.[0])).toBe("/api/v1/architecture?version=1");
  });
});
