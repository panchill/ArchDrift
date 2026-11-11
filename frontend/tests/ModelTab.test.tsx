import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import * as api from "../src/api";
import { ModelTab } from "../src/ModelTab";
import fixture from "../public/mocks/architecture.json";
import type { Architecture, CalmModel } from "../src/types";

vi.hoisted(() => vi.stubEnv("VITE_MOCKS", "1"));
const architecture = fixture as Architecture;
const file = (model: unknown = architecture.model) => {
  const source = JSON.stringify(model), value = new File([source], "architecture.json");
  Object.defineProperty(value, "text", { value: async () => source }); return value;
};
it.each([
  { nodes: [null], relationships: [] },
  { nodes: architecture.model.nodes, relationships: [{ "unique-id": "broken" }] },
  { nodes: architecture.model.nodes, relationships: [{ "unique-id": "broken", "relationship-type": { connects: { source: null } } }] },
])("rejects malformed mock uploads without replacing the current model: %j", async model => {
  const user = userEvent.setup(), onUploaded = vi.fn();
  render(<ModelTab architecture={architecture} snapshot={null} onUploaded={onUploaded} onGraph={vi.fn()} />);
  await user.upload(screen.getByLabelText("Файл CALM"), file(model));
  expect(await screen.findByRole("alert")).toHaveTextContent("Сервер не принял модель");
  expect(screen.getByRole("heading", { name: "Модель v1" })).toBeVisible();
  expect(onUploaded).not.toHaveBeenCalled();
});
it.each([
  [new api.ApiError(400, { code: "validation_error", message: "invalid" }), "Модель не прошла проверку"],
  [new api.ApiError(500), "Сервер вернул ошибку HTTP 500"],
  [new TypeError("fetch failed"), "Сервер не ответил"],
])("distinguishes HTTP errors from no response: %s", async (error, message) => {
  vi.spyOn(api, "uploadArchitecture").mockRejectedValue(error);
  const user = userEvent.setup();
  render(<ModelTab architecture={null} snapshot={null} onUploaded={vi.fn()} onGraph={vi.fn()} />);
  await user.upload(screen.getByLabelText("Файл CALM"), file());
  expect(await screen.findByRole("alert")).toHaveTextContent(message as string);
});
it("accepts drops only on the empty dropzone, not the loaded model", async () => {
  const upload = vi.spyOn(api, "uploadArchitecture").mockResolvedValue(architecture);
  function Host() {
    const [saved, setSaved] = useState<Architecture | null>(null);
    return <ModelTab architecture={saved} snapshot={null} onUploaded={setSaved} onGraph={vi.fn()} />;
  }
  render(<Host />);
  const drop = { dataTransfer: { files: [file()] } };
  fireEvent.drop(screen.getByRole("main"), drop);
  expect(upload).not.toHaveBeenCalled();
  fireEvent.drop(screen.getByRole("button", { name: /Перетащите architecture.json/ }), drop);
  await screen.findByRole("heading", { name: "Модель v1" });
  expect(upload).toHaveBeenCalledTimes(1);
  fireEvent.drop(screen.getByRole("table"), drop);
  expect(upload).toHaveBeenCalledTimes(1);
});
it("preserves the saved mock model and revision after an invalid replacement", async () => {
  const saved = await api.uploadArchitecture(architecture.model, 1);
  await expect(api.uploadArchitecture({ nodes: [null], relationships: [] } as unknown as CalmModel, saved.version))
    .rejects.toMatchObject({ status: 400, body: { code: "validation_error" } });
  expect(await api.loadArchitecture(new AbortController().signal)).toEqual(saved);
  expect(saved.version).toBe(2);
});
