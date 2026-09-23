import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { pathToUri } from "../../src/convert/uri.js";
import { registerHover } from "../../src/features/hover.js";
import type { LspTransportShape } from "../../src/protocol/LspTransport.js";
import type { Hover, HoverParams } from "../../src/protocol/types.js";
import type { SessionRegistryShape } from "../../src/session/registry.js";
import { makeSessionRegistry } from "../../src/session/registry.js";
import { copyFixtureProject } from "../utils/fixture.js";
import { testPlatform } from "../utils/platform.js";

/**
 * `registerHover`'s single handler, task 6 of the phase 4 plan. Wired
 * against a fake transport that only captures the registered handler (no
 * JSON-RPC round trip), mirroring `navigation.test.ts`'s harness:
 * `session.revalidate` is called directly, exactly once per test, to
 * populate `bundle()`/`graph()`; nothing here goes through the scheduler.
 * The fixture's `.okfit.toml` is overwritten with a config declaring
 * `[types.Module]` (description, guidance) and `[types.Module.fields.kind]`
 * (an extension field description) so the type-value and field-key hover
 * cases have real vocabulary to render.
 */

const platform = testPlatform();

const die = (name: string) => (): Effect.Effect<never> =>
	Effect.die(`fake transport: ${name} is not used by this test`);

/** A transport whose `onRequest` records each handler by method; every other member dies if called. */
const makeCapturingTransport = (): {
	readonly transport: LspTransportShape;
	readonly call: <P, R>(method: string, params: P) => Effect.Effect<R>;
} => {
	const handlers = new Map<string, (params: unknown) => Effect.Effect<unknown>>();
	const transport = {
		onInitialize: die("onInitialize"),
		onInitialized: die("onInitialized"),
		onShutdown: die("onShutdown"),
		onRequest: (method: string, handler: (params: unknown) => Effect.Effect<unknown>) =>
			Effect.sync(() => void handlers.set(method, handler)),
		onNotification: die("onNotification"),
		sendNotification: die("sendNotification"),
		sendRequest: die("sendRequest"),
		listen: Effect.die("fake transport: listen is not used by this test"),
	} as unknown as LspTransportShape;
	const call = <P, R>(method: string, params: P): Effect.Effect<R> => {
		const handler = handlers.get(method);
		return handler === undefined
			? Effect.die(`no handler registered for ${method}`)
			: (handler(params) as Effect.Effect<R>);
	};
	return { transport, call };
};

/** Declares `[types.Module]` (description, guidance) and `[types.Module.fields.kind]` (an extension field), over the fixture's own lint table. */
const CONFIG = `[lint]
generated_at_drift = "off"
status_missing = "off"

[types.Module]
description = "A packaged unit of code with an owner and a boundary."
guidance = "State the boundary and who owns it."

[types.Module.fields.kind]
description = "Which package shape this module is."
`;

const setup = () =>
	Effect.gen(function* () {
		const { root } = yield* copyFixtureProject();
		yield* Effect.promise(() => writeFile(join(root, ".okfit.toml"), CONFIG, "utf8"));
		const { transport, call } = makeCapturingTransport();
		const registry = yield* makeSessionRegistry({
			delay: "10 millis",
			maxWait: "10 seconds",
			onRevalidate: () => Effect.void,
			onDispose: () => Effect.void,
		});
		yield* registerHover(transport, registry);
		yield* registry.setFolders([root]);
		return {
			root,
			registry,
			call,
			sourcePath: join(root, "okf", "modules", "alpha.md"),
			targetPath: join(root, "okf", "modules", "beta.md"),
		};
	});

/** Opens `path` with `text` on its owning session, then revalidates directly so `bundle()`/`graph()` are populated. */
const openAndRevalidate = (registry: SessionRegistryShape, path: string, text: string) =>
	Effect.gen(function* () {
		const handle = Option.getOrThrow(yield* registry.sessionFor(path));
		yield* handle.session.open(path, text, 1);
		const now = yield* DateTime.now;
		yield* handle.session.revalidate({ now, tier: "full" });
	});

const TARGET = `---
type: Module
title: Target Concept
description: A tiny synthetic concept used only by @okfit/lsp's own hover tests.
status: stable
stale_after: "1965-01-01T00:00:00Z"
verified:
  - by: "human:fixture-author"
    at: "2026-01-01T00:00:00Z"
generated:
  by: "human:fixture-author"
  at: "2026-01-01T00:00:00Z"
---

# Target Concept

Nothing here is read by production code.
`;

const SOURCE = `---
type: Module
title: Source Concept
description: A tiny synthetic concept used only by @okfit/lsp's own hover tests.
resource: beta.md
kind: primary
generated:
  by: "human:fixture-author"
  at: "2026-01-01T00:00:00Z"
---

# Source Concept

See [Target](beta.md) for detail. Plain text with nothing to hover over.
`;

/** Links to a missing target (`missing.md`, no such file) and a file-kind target (`notes.txt`, a real bundle file that is never a concept). */
const SOURCE_WITH_BROKEN_LINKS = `---
type: Module
title: Source With Broken Links
description: A tiny synthetic concept used only by @okfit/lsp's own hover tests.
generated:
  by: "human:fixture-author"
  at: "2026-01-01T00:00:00Z"
---

# Source With Broken Links

See [Missing](missing.md) and [Notes](notes.txt).
`;

const positionOf = (text: string, needle: string): { readonly line: number; readonly character: number } => {
	const offset = text.indexOf(needle);
	const before = text.slice(0, offset);
	const line = before.split("\n").length - 1;
	const character = offset - before.lastIndexOf("\n") - 1;
	return { line, character };
};

/** `hover.contents` narrowed to `{ kind, value }`; fails the test outright when `hover` is `null`. */
const contentsOf = (hover: Hover | null): { readonly kind: string; readonly value: string } => {
	if (hover === null) throw new Error("expected a non-null hover result");
	return hover.contents as { readonly kind: string; readonly value: string };
};

describe("registerHover", () => {
	it.effect("a body link renders the target's title, type, status, trust tier and staleness", () =>
		Effect.gen(function* () {
			const { registry, call, sourcePath, targetPath } = yield* setup();
			yield* openAndRevalidate(registry, targetPath, TARGET);
			yield* openAndRevalidate(registry, sourcePath, SOURCE);

			const position = positionOf(SOURCE, "[Target]");
			const hover = yield* call<HoverParams, Hover | null>("textDocument/hover", {
				textDocument: { uri: pathToUri(sourcePath) },
				position: { line: position.line, character: position.character + 1 },
			});

			const { kind, value } = contentsOf(hover);
			assert.strictEqual(kind, "markdown");
			assert.include(value, "Target Concept");
			assert.include(value, "`Module`");
			assert.include(value, "`stable`");
			assert.include(value, "`human-reviewed`");
			assert.include(value, "`stale`");
		}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect("a frontmatter resource edge renders the same target facts", () =>
		Effect.gen(function* () {
			const { registry, call, sourcePath, targetPath } = yield* setup();
			yield* openAndRevalidate(registry, targetPath, TARGET);
			yield* openAndRevalidate(registry, sourcePath, SOURCE);

			const position = positionOf(SOURCE, "beta.md\nkind");
			const hover = yield* call<HoverParams, Hover | null>("textDocument/hover", {
				textDocument: { uri: pathToUri(sourcePath) },
				position: { line: position.line, character: position.character + 1 },
			});

			const { value } = contentsOf(hover);
			assert.include(value, "Target Concept");
			assert.include(value, "`Module`");
		}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect(
		"hover on a missing-kind edge answers null; hover on a file-kind edge (a link to a non-concept file) answers null (positive control above)",
		() =>
			Effect.gen(function* () {
				const { root, registry, call } = yield* setup();
				yield* Effect.promise(() => writeFile(join(root, "okf", "modules", "notes.txt"), "not a concept\n", "utf8"));
				const brokenPath = join(root, "okf", "modules", "broken.md");
				yield* openAndRevalidate(registry, brokenPath, SOURCE_WITH_BROKEN_LINKS);

				const missingPosition = positionOf(SOURCE_WITH_BROKEN_LINKS, "[Missing]");
				const missingHover = yield* call<HoverParams, Hover | null>("textDocument/hover", {
					textDocument: { uri: pathToUri(brokenPath) },
					position: { line: missingPosition.line, character: missingPosition.character + 1 },
				});
				assert.isNull(missingHover);

				const notesPosition = positionOf(SOURCE_WITH_BROKEN_LINKS, "[Notes]");
				const notesHover = yield* call<HoverParams, Hover | null>("textDocument/hover", {
					textDocument: { uri: pathToUri(brokenPath) },
					position: { line: notesPosition.line, character: notesPosition.character + 1 },
				});
				assert.isNull(notesHover);
			}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect(
		"a field key does not fire on a nested key (generated.by) or on the type key itself; a top-level field key still fires (positive control above)",
		() =>
			Effect.gen(function* () {
				const { registry, call, sourcePath } = yield* setup();
				yield* openAndRevalidate(registry, sourcePath, SOURCE);

				const nested = positionOf(SOURCE, "by:");
				const nestedHover = yield* call<HoverParams, Hover | null>("textDocument/hover", {
					textDocument: { uri: pathToUri(sourcePath) },
					position: nested,
				});
				assert.isNull(nestedHover);

				const typeKey = positionOf(SOURCE, "type: Module");
				const typeKeyHover = yield* call<HoverParams, Hover | null>("textDocument/hover", {
					textDocument: { uri: pathToUri(sourcePath) },
					position: typeKey,
				});
				assert.isNull(typeKeyHover);
			}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect("the type: value renders the declared type's description and guidance", () =>
		Effect.gen(function* () {
			const { registry, call, sourcePath } = yield* setup();
			yield* openAndRevalidate(registry, sourcePath, SOURCE);

			const position = positionOf(SOURCE, "Module\ntitle");
			const hover = yield* call<HoverParams, Hover | null>("textDocument/hover", {
				textDocument: { uri: pathToUri(sourcePath) },
				position: { line: position.line, character: position.character + 1 },
			});

			const { value } = contentsOf(hover);
			assert.include(value, "A packaged unit of code with an owner and a boundary.");
			assert.include(value, "State the boundary and who owns it.");
		}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect("a field key renders that field's own description", () =>
		Effect.gen(function* () {
			const { registry, call, sourcePath } = yield* setup();
			yield* openAndRevalidate(registry, sourcePath, SOURCE);

			const line = SOURCE.split("\n").findIndex((entry) => entry.startsWith("kind:"));
			const hover = yield* call<HoverParams, Hover | null>("textDocument/hover", {
				textDocument: { uri: pathToUri(sourcePath) },
				position: { line, character: 1 },
			});

			const { value } = contentsOf(hover);
			assert.include(value, "Which package shape this module is.");
		}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect("plain body text answers null (positive control above)", () =>
		Effect.gen(function* () {
			const { registry, call, sourcePath } = yield* setup();
			yield* openAndRevalidate(registry, sourcePath, SOURCE);

			const position = positionOf(SOURCE, "Plain text");
			const hover = yield* call<HoverParams, Hover | null>("textDocument/hover", {
				textDocument: { uri: pathToUri(sourcePath) },
				position: { line: position.line, character: position.character + 1 },
			});
			assert.isNull(hover);
		}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect("null before the first revalidate (no hang)", () =>
		Effect.gen(function* () {
			const { registry, call, sourcePath } = yield* setup();
			assert.isTrue(Option.isSome(yield* registry.sessionFor(sourcePath)));
			const hover = yield* call<HoverParams, Hover | null>("textDocument/hover", {
				textDocument: { uri: pathToUri(sourcePath) },
				position: { line: 0, character: 0 },
			});
			assert.isNull(hover);
		}).pipe(Effect.provide(platform), Effect.scoped),
	);
});
