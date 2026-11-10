import { describe, expect, it, vi } from "vitest";
import { loadSnapshot } from "../src/api";
import analysis from "../public/mocks/analysis.json";

describe("mock HTTP client", () => {
  it("loads the analysis response using an abort signal", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(analysis)));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    expect(await loadSnapshot(signal)).toEqual(analysis);
    expect(fetcher).toHaveBeenCalledOnce();
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
  it("surfaces malformed JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{broken")),
    );
    await expect(loadSnapshot(new AbortController().signal)).rejects.toThrow();
  });
});
