import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, loadAnalysis, loadArchitecture, uploadArchitecture } from "../src/api";
import architecture from "../public/mocks/architecture.json";
import analysis from "../public/mocks/analysis.json";
import type { CalmModel } from "../src/types";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const signal = () => new AbortController().signal;
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
describe("live API", () => {
  it("loads architecture and treats a missing model as null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(architecture)).mockResolvedValueOnce(json({}, 404));
    expect(await loadArchitecture(signal())).toEqual(architecture);
    expect(await loadArchitecture(signal())).toBeNull();
  });
  it("requests exactly five minutes, ending now, with an abort signal", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-11T12:00:00Z"));
    vi.mocked(fetch).mockResolvedValue(json(analysis));
    const abort = signal();
    expect(await loadAnalysis(abort)).toEqual(analysis);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    const params = new URL(String(url), "http://localhost").searchParams;
    expect(params.get("from")).toBe("2026-11-11T11:55:00.000Z");
    expect(params.get("to")).toBe("2026-11-11T12:00:00.000Z");
    expect(options?.signal).toBe(abort);
  });
  it("only treats the architecture_not_configured analysis conflict as no model", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ code: "architecture_not_configured" }, 409)).mockResolvedValueOnce(json({ code: "other" }, 409));
    expect(await loadAnalysis(signal())).toBeNull();
    await expect(loadAnalysis(signal())).rejects.toBeInstanceOf(ApiError);
  });
  it("sends current version without mutating the file and retries one conflict", async () => {
    const model = structuredClone(architecture.model) as CalmModel, before = structuredClone(model);
    vi.mocked(fetch).mockResolvedValueOnce(json({}, 409)).mockResolvedValueOnce(json({ ...architecture, version: 7 })).mockResolvedValueOnce(json({ ...architecture, version: 8 }));
    expect((await uploadArchitecture(model, 0)).version).toBe(8);
    const calls = vi.mocked(fetch).mock.calls;
    expect(JSON.parse(String(calls[0][1]?.body)).metadata.archdrift.version).toBe(0);
    expect(JSON.parse(String(calls[2][1]?.body)).metadata.archdrift.version).toBe(7);
    expect(model).toEqual(before);
    expect(calls[2][1]?.headers).toEqual({ "Content-Type": "application/json" });
  });
  it("surfaces a second conflict without retrying forever", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({}, 409)).mockResolvedValueOnce(json(architecture)).mockResolvedValueOnce(json({}, 409));
    await expect(uploadArchitecture(architecture.model as CalmModel, 0)).rejects.toMatchObject({ status: 409 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("preserves validation details and tolerates non-JSON errors", async () => {
    const body = { code: "validation_error", message: "Invalid", details: [{ field: "/nodes", message: "at least one service is required" }] };
    vi.mocked(fetch).mockResolvedValueOnce(json(body, 400)).mockResolvedValueOnce(new Response("Bad gateway", { status: 502 }));
    await expect(uploadArchitecture(architecture.model as CalmModel, 0)).rejects.toMatchObject({ status: 400, body });
    await expect(loadArchitecture(signal())).rejects.toMatchObject({ status: 502, body: undefined });
  });
  it("leaves model content validation to the live backend", async () => {
    const model = { nodes: [null], relationships: [] } as unknown as CalmModel;
    vi.mocked(fetch).mockResolvedValue(json({ code: "validation_error", message: "Invalid" }, 400));
    await expect(uploadArchitecture(model, 0)).rejects.toMatchObject({ status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).nodes).toEqual([null]);
  });
});
