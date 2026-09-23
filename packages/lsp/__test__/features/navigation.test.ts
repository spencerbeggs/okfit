import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { pathToUri } from "../../src/convert/uri.js";
import { registerNavigation } from "../../src/features/navigation.js";
import type { LspTransportShape } from "../../src/protocol/LspTransport.js";
import type {
	DefinitionParams,
	DocumentLink,
	DocumentLinkParams,
	Location,
	ReferenceParams,
} from "../../src/protocol/types.js";
import type { SessionRegistryShape } from "../../src/session/registry.js";
import { makeSessionRegistry } from "../../src/session/registry.js";
import { copyFixtureProject } from "../utils/fixture.js";
import { testPlatform } from "../utils/platform.js";

/**
 * `registerNavigation`'s three handlers, task 5 of the phase 4 plan. Wired
 * against a fake transport that only captures the registered handler per
 * method (no JSON-RPC round trip), so a request can be invoked directly and
 * `it.effect`'s virtual clock never has to govern a debounce -- unlike
 * `server.test.ts`'s `it.live` harness, nothing here goes through the
 * scheduler at all: `session.revalidate` is called directly, exactly once
 * per test, to populate `bundle()`/`graph()`.
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

const setup = () =>
	Effect.gen(function* () {
		const { root } = yield* copyFixtureProject();
		const { transport, call } = makeCapturingTransport();
		const registry = yield* makeSessionRegistry({
			delay: "10 millis",
			maxWait: "10 seconds",
			onRevalidate: () => Effect.void,
			onDispose: () => Effect.void,
		});
		yield* registerNavigation(transport, registry);
		yield* registry.setFolders([root]);
		return {
			root,
			registry,
			call,
			alphaPath: join(root, "okf", "modules", "alpha.md"),
			betaPath: join(root, "okf", "modules", "beta.md"),
			gammaPath: join(root, "okf", "modules", "gamma.md"),
			lonelyPath: join(root, "okf", "modules", "lonely.md"),
		};
	});

/** Opens `path` with `text` on its owning session, then revalidates directly (bypassing the scheduler this feature never needs) so `bundle()`/`graph()` are populated. */
const openAndRevalidate = (registry: SessionRegistryShape, path: string, text: string) =>
	Effect.gen(function* () {
		const handle = Option.getOrThrow(yield* registry.sessionFor(path));
		yield* handle.session.open(path, text, 1);
		const now = yield* DateTime.now;
		yield* handle.session.revalidate({ now, tier: "full" });
	});

const ALPHA = `---
type: Module
title: Alpha
description: A tiny synthetic concept used only by @okfit/lsp's own tests.
resource: alpha.md
kind: package
sources:
  - resource: gamma.md
generated:
  by: "human:fixture-author"
  at: "2026-01-01T00:00:00Z"
---

# Alpha

See [Beta](beta.md) and [Missing](missing.md) and [Example](https://example.com/).
`;

const GAMMA = `---
type: Module
title: Gamma
description: A control concept used only by @okfit/lsp's own tests.
resource: gamma.md
kind: package
status: stable
generated:
  by: "human:fixture-author"
  at: "2026-01-01T00:00:00Z"
---

# Gamma

See [Beta](beta.md).
`;

/**
 * Overrides the fixture's own `beta.md`, dropping its `resource: beta.md`
 * self-referencing field: the fixture sets that field on every concept, and
 * a self-referencing `resource` is itself a genuine graph edge (a concept
 * pointing at its own file), which would otherwise count as one more
 * predecessor edge into beta and throw off the referrer count below.
 */
const BETA = `---
type: Module
title: Beta
description: A tiny synthetic concept used only by @okfit/lsp's own tests.
kind: package
generated:
  by: "human:fixture-author"
  at: "2026-01-01T00:00:00Z"
---

# Beta

Nothing here is read by production code; this bundle only gives the tests a real file tree.
`;

/** Nothing links here, and (unlike the fixture's own concepts) no self-referencing `resource` field: the zero-referrer control for `textDocument/references`. */
const LONELY = `---
type: Module
title: Lonely
description: A control concept used only by @okfit/lsp's own tests.
kind: package
status: stable
generated:
  by: "human:fixture-author"
  at: "2026-01-01T00:00:00Z"
---

# Lonely

Nothing points at this concept.
`;

describe("registerNavigation", () => {
	describe("textDocument/documentLink", () => {
		it.effect(
			"a body link and a frontmatter path field both appear with their resolved target; a broken body link is omitted; a URL body link stays a link with the URL as its target",
			() =>
				Effect.gen(function* () {
					const { registry, call, alphaPath, betaPath, gammaPath } = yield* setup();
					// gamma.md must exist (in the overlay is enough) for alpha's `sources.resource` field to
					// resolve to it rather than to a `missing` node, which document links always omit.
					yield* openAndRevalidate(registry, gammaPath, GAMMA);
					yield* openAndRevalidate(registry, alphaPath, ALPHA);

					const links = yield* call<DocumentLinkParams, ReadonlyArray<DocumentLink>>("textDocument/documentLink", {
						textDocument: { uri: pathToUri(alphaPath) },
					});

					assert.isTrue(links.some((link) => link.target === pathToUri(betaPath))); // body link, positive control
					assert.isTrue(links.some((link) => link.target === pathToUri(gammaPath))); // frontmatter sources.resource
					assert.isTrue(links.some((link) => link.target === "https://example.com/")); // raw URL, never a graph edge
					assert.isFalse(links.some((link) => link.target?.endsWith("missing.md"))); // dangling target: omitted
				}).pipe(Effect.provide(platform), Effect.scoped),
		);

		it.effect("an empty list before the first revalidate; a non-file URI answers the same way", () =>
			Effect.gen(function* () {
				const { registry, call, alphaPath } = yield* setup();
				// Session exists (setFolders built the folder set) but nothing has been opened or revalidated yet.
				assert.isTrue(Option.isSome(yield* registry.sessionFor(alphaPath)));
				const links = yield* call<DocumentLinkParams, ReadonlyArray<DocumentLink>>("textDocument/documentLink", {
					textDocument: { uri: pathToUri(alphaPath) },
				});
				assert.deepStrictEqual(links, []);
				const nonFile = yield* call<DocumentLinkParams, ReadonlyArray<DocumentLink>>("textDocument/documentLink", {
					textDocument: { uri: "untitled:Untitled-1" },
				});
				assert.deepStrictEqual(nonFile, []);
			}).pipe(Effect.provide(platform), Effect.scoped),
		);
	});

	describe("textDocument/definition", () => {
		it.effect(
			"an edge at the position answers with its target's definition location; a non-link position answers null",
			() =>
				Effect.gen(function* () {
					const { registry, call, alphaPath, betaPath } = yield* setup();
					yield* openAndRevalidate(registry, alphaPath, ALPHA);
					const offset = ALPHA.indexOf("[Beta]") + 1;
					const before = ALPHA.slice(0, offset);
					const line = before.split("\n").length - 1;
					const character = offset - before.lastIndexOf("\n") - 1;

					const location = yield* call<DefinitionParams, Location | null>("textDocument/definition", {
						textDocument: { uri: pathToUri(alphaPath) },
						position: { line, character },
					});
					assert.isNotNull(location);
					assert.strictEqual(location?.uri, pathToUri(betaPath));

					const headingOffset = ALPHA.indexOf("# Alpha");
					const headingBefore = ALPHA.slice(0, headingOffset);
					const headingLine = headingBefore.split("\n").length - 1;

					const none = yield* call<DefinitionParams, Location | null>("textDocument/definition", {
						textDocument: { uri: pathToUri(alphaPath) },
						position: { line: headingLine, character: 0 }, // the heading itself: not inside any link
					});
					assert.isNull(none);
				}).pipe(Effect.provide(platform), Effect.scoped),
		);

		it.effect("null before the first revalidate (no hang)", () =>
			Effect.gen(function* () {
				const { registry, call, alphaPath } = yield* setup();
				assert.isTrue(Option.isSome(yield* registry.sessionFor(alphaPath)));
				const location = yield* call<DefinitionParams, Location | null>("textDocument/definition", {
					textDocument: { uri: pathToUri(alphaPath) },
					position: { line: 0, character: 0 },
				});
				assert.isNull(location);
			}).pipe(Effect.provide(platform), Effect.scoped),
		);
	});

	describe("textDocument/references", () => {
		it.effect(
			"a concept with two referring files gets one Location per referring edge; one with none gets [] (beside the control)",
			() =>
				Effect.gen(function* () {
					const { registry, call, alphaPath, betaPath, gammaPath, lonelyPath } = yield* setup();
					yield* openAndRevalidate(registry, betaPath, BETA);
					yield* openAndRevalidate(registry, alphaPath, ALPHA);
					yield* openAndRevalidate(registry, gammaPath, GAMMA);
					yield* openAndRevalidate(registry, lonelyPath, LONELY);

					const references = yield* call<ReferenceParams, ReadonlyArray<Location>>("textDocument/references", {
						textDocument: { uri: pathToUri(betaPath) },
						position: { line: 0, character: 0 },
						context: { includeDeclaration: false },
					});
					assert.strictEqual(references.length, 2);
					assert.isTrue(references.some((location) => location.uri === pathToUri(alphaPath)));
					assert.isTrue(references.some((location) => location.uri === pathToUri(gammaPath)));

					const none = yield* call<ReferenceParams, ReadonlyArray<Location>>("textDocument/references", {
						textDocument: { uri: pathToUri(lonelyPath) },
						position: { line: 0, character: 0 },
						context: { includeDeclaration: false },
					});
					assert.deepStrictEqual(none, []);
				}).pipe(Effect.provide(platform), Effect.scoped),
		);

		it.effect("includeDeclaration adds the definition location", () =>
			Effect.gen(function* () {
				const { registry, call, alphaPath, betaPath, gammaPath } = yield* setup();
				yield* openAndRevalidate(registry, betaPath, BETA);
				yield* openAndRevalidate(registry, alphaPath, ALPHA);
				yield* openAndRevalidate(registry, gammaPath, GAMMA);

				const withDeclaration = yield* call<ReferenceParams, ReadonlyArray<Location>>("textDocument/references", {
					textDocument: { uri: pathToUri(betaPath) },
					position: { line: 0, character: 0 },
					context: { includeDeclaration: true },
				});
				assert.strictEqual(withDeclaration.length, 3);
				assert.isTrue(withDeclaration.some((location) => location.uri === pathToUri(betaPath)));
			}).pipe(Effect.provide(platform), Effect.scoped),
		);

		it.effect("[] before the first revalidate (no hang)", () =>
			Effect.gen(function* () {
				const { registry, call, betaPath } = yield* setup();
				assert.isTrue(Option.isSome(yield* registry.sessionFor(betaPath)));
				const references = yield* call<ReferenceParams, ReadonlyArray<Location>>("textDocument/references", {
					textDocument: { uri: pathToUri(betaPath) },
					position: { line: 0, character: 0 },
					context: { includeDeclaration: false },
				});
				assert.deepStrictEqual(references, []);
			}).pipe(Effect.provide(platform), Effect.scoped),
		);
	});
});
