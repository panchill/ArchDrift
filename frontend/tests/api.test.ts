import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, loadAnalysis, loadArchitecture } from "../src/api";
import architecture from "../public/mocks/architecture.json";
import analysis from "../public/mocks/analysis.json";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const signal = () => new AbortController().signal;
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
describe("UI fixture adapter", () => {
  it("loads fixture URLs with abort signals and never requests a backend", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(architecture)).mockResolvedValueOnce(json(analysis));
    const abort = signal();
    expect(await loadArchitecture(abort)).toEqual(architecture);
    expect(await loadAnalysis(abort)).toEqual(analysis);
    expect(vi.mocked(fetch).mock.calls).toEqual([
      ["/mocks/architecture.json", { signal: abort }],
      ["/mocks/analysis.json", { signal: abort }],
    ]);
  });
  it("supports the empty-model screen when the fixture is absent", async () => {
    vi.mocked(fetch).mockResolvedValue(json({}, 404));
    expect(await loadArchitecture(signal())).toBeNull();
  });
  it("surfaces fixture load failures", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(loadAnalysis(signal())).rejects.toBeInstanceOf(ApiError);
  });
  it("does not load an aborted request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(loadArchitecture(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
