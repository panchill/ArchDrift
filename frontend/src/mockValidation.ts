import type { ErrorBody } from "./api";
import type { CalmModel } from "./types";

// The fixture adapter has no backend validator. Reject malformed render inputs
// before saving; this is a structural check, not a replacement for CALM validation.
export function mockValidation(model: CalmModel): NonNullable<ErrorBody["details"]> {
  const errors: NonNullable<ErrorBody["details"]> = [];
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const text = (v: unknown) => typeof v === "string" && v.length > 0;
  const end = (v: unknown) => object(v) && text(v.node) && (v.interfaces === undefined || (Array.isArray(v.interfaces) && v.interfaces.every(text)));
  model.nodes.forEach((node, i) => {
    const field = `/nodes/${i}`;
    if (!object(node)) errors.push({ field, message: "expected an object" });
    else {
      for (const key of ["unique-id", "name", "node-type"])
        if (!text(node[key])) errors.push({ field: `${field}/${key}`, message: "not supported" });
      if (node.interfaces !== undefined && (!Array.isArray(node.interfaces) || node.interfaces.some(v => !object(v) || !text(v["unique-id"]))))
        errors.push({ field: `${field}/interfaces`, message: "expected a non-empty unique interface ID" });
    }
  });
  model.relationships.forEach((relationship, i) => {
    const field = `/relationships/${i}`;
    if (!object(relationship)) { errors.push({ field, message: "expected an object" }); return; }
    if (!text(relationship["unique-id"])) errors.push({ field: `${field}/unique-id`, message: "expected a non-empty unique relationship ID" });
    const type = relationship["relationship-type"];
    if (!object(type)) { errors.push({ field: `${field}/relationship-type`, message: "expected an object" }); return; }
    const connects = type.connects, composed = type["composed-of"];
    if ((connects === undefined) === (composed === undefined)) errors.push({ field: `${field}/relationship-type`, message: "expected exactly one of connects or composed-of" });
    else if (connects !== undefined && (!object(connects) || !end(connects.source) || !end(connects.destination)))
      errors.push({ field: `${field}/relationship-type/connects`, message: "not supported" });
    else if (composed !== undefined && (!object(composed) || !text(composed.container) || !Array.isArray(composed.nodes) || !composed.nodes.every(text)))
      errors.push({ field: `${field}/relationship-type/composed-of`, message: "not supported" });
  });
  return errors;
}
