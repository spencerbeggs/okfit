import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import { Bundle } from "@okfit/core";
import { Effect, Layer, Result } from "effect";
import { Canonical, ContentUnhashableError } from "../src/Canonical.js";
import { Derivation } from "../src/Derivation.js";

const BODY = "\n# Title\n\nText.\n";
const src = (fm: string) => `---\n${fm}\n---${BODY}`;
const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** The canonical string a frontmatter value contributes, or the failure, through the real contentInput. */
const canonical = (frontmatter: Record<string, unknown>) => Canonical.contentInput(frontmatter, "---\n---\n");
const ok = (frontmatter: Record<string, unknown>): string => {
	const result = canonical(frontmatter);
	if (Result.isFailure(result)) return assert.fail(result.failure.message);
	return result.success;
};

/** Oracle: JSON.stringify of the value with object keys sorted at every depth (okfit's former Canonical.json). */
const sortedStringify = (value: unknown): string =>
	JSON.stringify(value, (_key, inner: unknown) =>
		inner !== null && typeof inner === "object" && !Array.isArray(inner)
			? Object.fromEntries(
					Object.entries(inner as Record<string, unknown>).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
				)
			: inner,
	);

describe("Canonical.contentInput canonicalization", () => {
	it("sorts keys recursively and keeps array order", () => {
		assert.include(ok({ b: 1, a: { d: [2, 1], c: null } }), '"frontmatter":{"a":{"c":null,"d":[2,1]},"b":1}');
	});

	it("encodes a bigint as its bare decimal literal, distinct from the same digits as a string", () => {
		const big = 123456789012345678901n;
		assert.include(ok({ ticket: big, list: [big] }), '{"list":[123456789012345678901],"ticket":123456789012345678901}');
		assert.notStrictEqual(ok({ ticket: big }), ok({ ticket: "123456789012345678901" }));
	});

	it("matches sorted JSON.stringify for every non-bigint value", () => {
		const value = {
			s: 'q"\\u\u00e9\ud83d\ude00',
			n: -1.5,
			nan: Number.NaN,
			t: true,
			z: null,
			u: undefined,
			a: [undefined, 1, { y: 2, x: 1 }],
		};
		assert.include(ok(value), `"frontmatter":${sortedStringify(value)}`);
	});

	it("refuses a value holding an unpaired surrogate, naming its path (okfit#327)", () => {
		const result = canonical({ title: "ok", sources: [{ id: "a", resource: "x\ud800y" }] });
		if (Result.isSuccess(result)) return assert.fail("an unpaired surrogate must not hash");
		assert.instanceOf(result.failure, ContentUnhashableError);
		assert.deepStrictEqual(result.failure.path, ["sources", 0, "resource"]);
		assert.include(result.failure.message, "sources.0.resource cannot be hashed");
	});

	it("refuses an object key holding an unpaired surrogate", () => {
		assert.isTrue(Result.isFailure(canonical({ "k\udc00": 1 })));
	});

	it("still hashes a well-formed surrogate pair", () => {
		assert.include(ok({ emoji: "\ud83d\ude00" }), `"emoji":"\ud83d\ude00"`);
	});
});

describe("Canonical.contentInput", () => {
	it("drops bookkeeping keys and renders[].body", () => {
		const raw = {
			type: "Publication",
			title: "T",
			status: "stable",
			stale_after: "2027-01-01T00:00:00Z",
			generated: { by: "human:x", at: "2026-01-01T00:00:00Z" },
			verified: [{ by: "human:x", at: "2026-01-01T00:00:00Z" }],
			integrity: { generated: { body: "0123456789abcdef" } },
			timestamp: "2026-01-01T00:00:00Z",
			renders: [{ path: "a.md", body: "0123456789abcdef", body_sha256: "a".repeat(64) }],
		};
		const input = JSON.parse(Result.getOrThrow(Canonical.contentInput(raw, src("type: Publication"))));
		assert.deepStrictEqual(input.frontmatter, { renders: [{ path: "a.md" }], title: "T", type: "Publication" });
		assert.strictEqual(input.body, "# Title\n\nText.");
	});

	it.effect("timestamps in a loaded concept's raw frontmatter arrive as strings", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-canonical-")));
			yield* Effect.promise(() =>
				writeFile(join(root, "a.md"), "---\ntype: Note\nstale_after: 2027-01-01T00:00:00Z\n---\n\nBody.\n"),
			);
			const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(platform));
			const concept = [...bundle.concepts.values()][0];
			assert.isDefined(concept);
			assert.strictEqual(typeof concept?.frontmatter.raw.stale_after, "string");
		}),
	);

	it.effect("an integer beyond 2^53 in a loaded concept hashes instead of defecting", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-canonical-")));
			yield* Effect.promise(() =>
				writeFile(join(root, "a.md"), "---\ntype: Note\nticket: 123456789012345678901\n---\n\nBody.\n"),
			);
			const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(platform));
			const concept = [...bundle.concepts.values()][0];
			assert.isDefined(concept);
			if (concept === undefined) return;
			assert.strictEqual(typeof concept.frontmatter.raw.ticket, "bigint");
			const digest = yield* Derivation.contentDigest(concept.frontmatter.raw, concept.document.source);
			assert.match(digest, /^[0-9a-f]{16}$/u);
		}).pipe(Effect.provide(NodeCrypto.layerDigest)),
	);
});

describe("Derivation digests", () => {
	it.effect("bodyDigest is the 16-hex prefix of the full sha256", () =>
		Effect.gen(function* () {
			const short = yield* Derivation.bodyDigest(src("type: X"));
			assert.match(short, /^[0-9a-f]{16}$/u);
			const full = yield* Derivation.digestFull(Derivation.body(src("type: X")));
			assert.strictEqual(full.length, 64);
			assert.strictEqual(short, full.slice(0, 16));
		}).pipe(Effect.provide(NodeCrypto.layerDigest)),
	);

	it.effect("contentDigest ignores style, order, CRLF and bookkeeping; sees authored edits", () =>
		Effect.gen(function* () {
			const a = yield* Derivation.contentDigest(
				{ type: "Decision", tags: ["x", "y"], title: "T" },
				src("type: Decision"),
			);
			const sameDifferentStyle = yield* Derivation.contentDigest(
				{ title: "T", tags: ["x", "y"], type: "Decision", status: "draft", stale_after: "2030-01-01T00:00:00Z" },
				src("type: Decision").replace(/\n/g, "\r\n"),
			);
			const editedTitle = yield* Derivation.contentDigest(
				{ type: "Decision", tags: ["x", "y"], title: "U" },
				src("type: Decision"),
			);
			const reorderedTags = yield* Derivation.contentDigest(
				{ type: "Decision", tags: ["y", "x"], title: "T" },
				src("type: Decision"),
			);
			const editedBody = yield* Derivation.contentDigest(
				{ type: "Decision", tags: ["x", "y"], title: "T" },
				src("type: Decision").replace("Text.", "Text!"),
			);
			assert.strictEqual(a, sameDifferentStyle);
			assert.notStrictEqual(a, editedTitle);
			assert.notStrictEqual(a, reorderedTags);
			assert.notStrictEqual(a, editedBody);
		}).pipe(Effect.provide(NodeCrypto.layerDigest)),
	);
});
