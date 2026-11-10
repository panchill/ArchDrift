import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Core, CytoscapeOptions } from "cytoscape";
import App from "../src/App";
import analysis from "../public/mocks/analysis.json";

const { cores } = vi.hoisted(() => ({ cores: [] as Core[] }));
// Only replace the canvas renderer: integration still uses real Cytoscape elements/events.
vi.mock("cytoscape", async (importOriginal) => {
  const module = await importOriginal<{
    default: typeof import("cytoscape");
  }>();
  return {
    default: (options: CytoscapeOptions) => {
      const core = module.default({
        ...options,
        container: undefined,
        headless: true,
        styleEnabled: false,
        layout: { name: "preset" },
      });
      cores.push(core);
      return core;
    },
  };
});
const respond = () => new Response(JSON.stringify(analysis));
beforeEach(() => {
  cores.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => respond()),
  );
});

describe("mock → HTTP client → React → Cytoscape", () => {
  it("updates the zoom indicator and resets to 100% in the detailed view", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("img");
    await user.click(
      screen.getByRole("button", { name: "Endpoints и воркеры" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Сбросить масштаб к 100%" }),
    );
    expect(screen.getByLabelText("Текущий масштаб")).toHaveTextContent("100%");
    await user.click(screen.getByRole("button", { name: "Увеличить" }));
    expect(screen.getByLabelText("Текущий масштаб")).toHaveTextContent("125%");
    await user.click(screen.getByRole("button", { name: "Уменьшить" }));
    expect(screen.getByLabelText("Текущий масштаб")).toHaveTextContent("100%");
    expect(cores.at(-1)!.nodes(".endpoint")).toHaveLength(62);
  });
  it("loads responses and renders all resource kinds and summary", async () => {
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Загрузка");
    expect(await screen.findByRole("img")).toHaveAccessibleName(/25 узлов/);
    expect(screen.getByLabelText("Сводка анализа")).toHaveTextContent("1 нарушения");
    const cy = cores.at(-1)!;
    expect(cy.nodes(".postgres_database")).toHaveLength(1);
    expect(cy.nodes(".kafka_topic")).toHaveLength(1);
    expect(cy.nodes(".service")).toHaveLength(23);
  });
  it("switches to endpoints, keeps compound membership and destroys replaced graph", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("img");
    const previous = cores.at(-1)!;
    await user.click(
      screen.getByRole("button", { name: "Endpoints и воркеры" }),
    );
    expect(screen.getByRole("img")).toHaveAccessibleName(/87 узлов, 64 связей/);
    expect(previous.destroyed()).toBe(true);
    expect(cores.at(-1)!.nodes(".endpoint")).toHaveLength(62);
    expect(cores.at(-1)!.nodes(".worker")).toHaveLength(0);
  });
  it("filters unexpected calls", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("img");
    await user.selectOptions(
      screen.getByLabelText("Статус связи"),
      "unexpected",
    );
    expect(cores.at(-1)!.edges()).toHaveLength(1);
  });
  it("opens a violation, shows its evidence and restores the violation list", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("img");
    await user.click(
      screen.getAllByRole("button", { name: "Показать на схеме" })[0],
    );
    const panel = within(screen.getByLabelText("Детали графа"));
    expect(panel.getByText("http_call")).toBeVisible();
    expect(
      panel.getByText(analysis.violations[0].exampleTraceId),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Endpoints и воркеры" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(panel.getByRole("button", { name: /К списку нарушений/ }));
    expect(screen.getByText(analysis.violations[0].message)).toBeVisible();
  });
  it("handles real Cytoscape tap events without recreating the graph", async () => {
    render(<App />);
    await screen.findByRole("img");
    const cy = cores.at(-1)!;
    act(() => {
      cy.getElementById("postgres:astronomy-db:astronomy_db").emit("tap");
    });
    expect(
      within(screen.getByLabelText("Детали графа")).getByText("astronomy-db"),
    ).toBeVisible();
    expect(cores.at(-1)).toBe(cy);
  });
  it("supports keyboard-accessible graph selection", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("img");
    await user.click(
      screen.getByText("Список связей и узлов — выбор с клавиатуры"),
    );
    const button = screen.getByRole("button", {
      name: "astronomy_db PostgreSQL",
    });
    button.focus();
    await user.keyboard("{Enter}");
    expect(
      within(screen.getByLabelText("Детали графа")).getByText("astronomy-db"),
    ).toBeVisible();
    expect(
      cores
        .at(-1)!
        .getElementById("postgres:astronomy-db:astronomy_db")
        .selected(),
    ).toBe(true);
  });
  it("recovers from a failed request through retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond()),
    );
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByRole("img")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("aborts outstanding requests on unmount and destroys the graph", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options: { signal: AbortSignal }) => {
        signals.push(options.signal);
        return respond();
      }),
    );
    const { unmount } = render(<App />);
    await screen.findByRole("img");
    const cy = cores.at(-1)!;
    unmount();
    expect(cy.destroyed()).toBe(true);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
  it("refreshes fixtures on demand", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("img");
    await user.click(screen.getByRole("button", { name: /Обновить сейчас/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("img")).toBeVisible();
  });
  it("handles a valid no-observations snapshot without claiming incomplete telemetry", async () => {
    const empty = {
      ...analysis,
      edges: [],
      violations: [],
      nodes: analysis.nodes
        .filter((n) => n.known)
        .map((n) => ({ ...n, observed: false })),
      diagnostics: {
        unmatchedHttpClientSpans: 0,
        serviceLevelOperations: 0,
        unresolvedResourceSpans: 0,
        ignoredMessagingSpans: 0,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(empty))),
    );
    render(<App />);
    await screen.findByRole("img");
    expect(screen.queryByText("Телеметрия неполная")).toBeNull();
    expect(
      screen.getByText("В этом интервале нет наблюдаемых связей."),
    ).toBeVisible();
    expect(cores.at(-1)!.edges()).toHaveLength(0);
    expect(cores.at(-1)!.nodes()).toHaveLength(25);
  });
  it("ignores stale responses after a newer refresh has completed", async () => {
    const pending: Array<() => void> = [];
    const recent = {
      ...analysis,
      violations: [],
      edges: analysis.edges.filter((e) => e.status !== "unexpected"),
    };
    let count = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        count++;
        if (count <= 1)
          return new Promise<Response>((resolve) =>
            pending.push(() => resolve(respond())),
          );
        return Promise.resolve(new Response(JSON.stringify(recent)));
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Обновить сейчас/ }));
    await screen.findByRole("img");
    expect(screen.getByLabelText("Сводка анализа")).toHaveTextContent(
      "0 нарушения",
    );
    await act(async () => {
      pending.forEach((resolve) => resolve());
    });
    expect(screen.getByLabelText("Сводка анализа")).toHaveTextContent(
      "0 нарушения",
    );
  });
});
