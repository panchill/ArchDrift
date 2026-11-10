import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
  throw new Error(
    "Usage: node scripts/generate-architecture-mock.mjs [--check]",
  );
}
const source = new URL(
  "../../examples/opentelemetry-demo.architecture.json",
  import.meta.url,
);
const output = new URL("../public/mocks/architecture.json", import.meta.url);
const model = JSON.parse(readFileSync(source, "utf8"));
const analysis = JSON.parse(
  readFileSync(
    new URL("../public/mocks/analysis.json", import.meta.url),
    "utf8",
  ),
);
const version = analysis.architectureVersion;
if (!Number.isSafeInteger(version) || version < 1) {
  throw new Error("analysis.architectureVersion must be a positive integer");
}

// The demo intentionally uses a stale declaration. Fail rather than silently
// changing the scenario if the source no longer has exactly one such link.
const staleLinks = model.relationships.filter((relationship) => {
  const connects = relationship["relationship-type"].connects;
  return (
    connects?.source.node === "checkout" &&
    connects.destination.node === "email"
  );
});
if (staleLinks.length !== 1) {
  throw new Error(
    "Expected exactly one checkout → email declaration in the source model",
  );
}
model.relationships = model.relationships.filter(
  (relationship) => relationship !== staleLinks[0],
);
model.metadata.archdrift.version = version;
const expected =
  JSON.stringify(
    {
      version,
      // Fixed synthetic snapshot: regeneration must not depend on the current clock.
      updatedAt: "2026-11-10T09:55:00Z",
      model,
    },
    null,
    2,
  ) + "\n";
const current = existsSync(output) ? readFileSync(output, "utf8") : null;

if (args[0] === "--check") {
  if (current !== expected) {
    console.error(
      "architecture.json is missing or stale. Run: cd frontend && npm run mocks:generate",
    );
    process.exitCode = 1;
  } else {
    console.log("architecture.json is up to date");
  }
} else if (current !== expected) {
  writeFileSync(output, expected);
  console.log("Generated public/mocks/architecture.json");
} else {
  console.log("architecture.json is already up to date");
}
