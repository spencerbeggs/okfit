import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import { Bundle } from "@okfit/core";
import { Effect, Layer } from "effect";
import { Canonical } from "../src/Canonical.js";
import { Derivation } from "../src/Derivation.js";

const BODY = "\n# Title\n\nText.\n";
const src = (fm: string) => `---\n${fm}\n---${BODY}`;
const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("Canonical.json", () => {
	it("sorts keys recursively and keeps array order", () => {
		assert.strictEqual(Canonical.json({ b: 1, a: { d: [2, 1], c: null } }), '{"a":{"c":null,"d":[2,1]},"b":1}');
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
		const input = JSON.parse(Canonical.contentInput(raw, src("type: Publication")));
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
});

describe("Derivation digests", () => {
	it.effect("bodyDigest is the 16-hex prefix of the full sha256", () =>
		Effect.gen(function* () {
			const short = yield* Derivation.bodyDigest(src("type: X"));
			assert.match(short, /^[0-9a-f]{16}$/u);
			const full = yield* Derivation.digestFull(Derivation.body(src("type: X")));
			assert.strictEqual(full.length, 64);
			assert.strictEqual(short, full.slice(0, 16));
		}).pipe(Effect.provide(NodeCrypto.layer)),
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
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);
});
