import { assert, describe, it } from "@effect/vitest";
import { Effect, Path } from "effect";
import { makeDiagnosticsFeature } from "../../src/features/diagnostics.js";
import { makeFakeRegistry, unusedTransport } from "../utils/fakeRegistry.js";

const ROOT = "/bundle";
const FILE = "/bundle/modules/alpha.md";

describe("makeDiagnosticsFeature: document events", () => {
	it.effect("open and save schedule full, change and close schedule edit, each after its overlay update", () =>
		Effect.gen(function* () {
			const { registry, calls } = makeFakeRegistry(ROOT);
			const feature = yield* makeDiagnosticsFeature(unusedTransport, registry);
			yield* feature.onDocumentEvent({ kind: "open", path: FILE, text: "a", version: 1 });
			yield* feature.onDocumentEvent({ kind: "change", path: FILE, text: "b", version: 2 });
			yield* feature.onDocumentEvent({ kind: "save", path: FILE });
			yield* feature.onDocumentEvent({ kind: "close", path: FILE });
			assert.deepStrictEqual(calls, [
				{ op: "open", path: FILE, text: "a", version: 1 },
				{ op: "schedule", tier: "full" },
				{ op: "change", path: FILE, text: "b", version: 2 },
				{ op: "schedule", tier: "edit" },
				{ op: "schedule", tier: "full" },
				{ op: "close", path: FILE },
				{ op: "schedule", tier: "edit" },
			]);
		}).pipe(Effect.provide(Path.layer)),
	);

	it.effect("a document outside every bundle root touches neither session nor scheduler", () =>
		Effect.gen(function* () {
			const { registry, calls } = makeFakeRegistry(ROOT);
			const feature = yield* makeDiagnosticsFeature(unusedTransport, registry);
			yield* feature.onDocumentEvent({ kind: "open", path: "/elsewhere/README.md", text: "a", version: 1 });
			yield* feature.onDocumentEvent({ kind: "save", path: "/elsewhere/README.md" });
			assert.deepStrictEqual(calls, []);
		}).pipe(Effect.provide(Path.layer)),
	);
});
