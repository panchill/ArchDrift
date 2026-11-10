import { describe, expect, it, vi } from "vitest";
import { loadSnapshot } from "../src/api";
import architecture from "../public/mocks/architecture.json";
import analysis from "../public/mocks/analysis.json";

describe("mock HTTP client", () => {
  it("loads the two actual response formats using an abort signal", async () => {
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("architecture") ? architecture : analysis,
          ),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    expect(await loadSnapshot(signal)).toEqual({ architecture, analysis });
    expect(fetcher).toHaveBeenCalledWith("/mocks/architecture.json", {
      signal,
    });
    expect(fetcher).toHaveBeenCalledWith("/mocks/analysis.json", { signal });
  });
  it("reports non-200 responses rather than rendering invalid data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    await expect(loadSnapshot(new AbortController().signal)).rejects.toThrow(
      "HTTP 404",
    );
  });
  it("rejects a mismatched architecture version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.includes("architecture")
                ? architecture
                : { ...analysis, architectureVersion: 2 },
            ),
          ),
      ),
    );
    await expect(loadSnapshot(new AbortController().signal)).rejects.toThrow(
      "Версии архитектуры",
    );
  });
  it("surfaces malformed JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{broken")),
    );
    await expect(loadSnapshot(new AbortController().signal)).rejects.toThrow();
  });
});
