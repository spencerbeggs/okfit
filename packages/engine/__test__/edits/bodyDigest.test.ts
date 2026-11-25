import { assert, describe, it } from "@effect/vitest";
import { Derivation } from "@okfit/profiles";
import { Effect } from "effect";
import { rerecordBodyDigest } from "../../src/edits/bodyDigest.js";
import { TestPlatform } from "../utils/platform.js";

const concept = (integrity: string, link: string) =>
	`---\ntype: Decision\ntitle: T\n${integrity}---\n\n# T\n\nSee [a](${link}).\n`;
const block = (digest: string) => `x-okfit-integrity:\n  generated:\n    body: ${digest}\n`;

describe("rerecordBodyDigest", () => {
	it.effect("re-records the body digest when it matched before the edit", () =>
		Effect.gen(function* () {
			const before0 = concept("", "a.md");
			const digestBefore = yield* Derivation.bodyDigest(before0);
			const before = concept(block(digestBefore), "a.md");
			const after = concept(block(digestBefore), "b.md");
			const digestAfter = yield* Derivation.bodyDigest(after);
			const out = yield* rerecordBodyDigest({ recorded: digestBefore, before, after });
			assert.strictEqual(out.outcome, "rerecorded");
			assert.strictEqual(out.text, concept(block(digestAfter), "b.md"));
			assert.notStrictEqual(digestBefore, digestAfter);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("leaves a stale digest stale", () =>
		Effect.gen(function* () {
			const recorded = "0123456789abcdef";
			const before = concept(block(recorded), "a.md");
			const after = concept(block(recorded), "b.md");
			const out = yield* rerecordBodyDigest({ recorded, before, after });
			assert.strictEqual(out.outcome, "untouched");
			assert.strictEqual(out.text, after);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("an unchanged body is untouched", () =>
		Effect.gen(function* () {
			const digest = yield* Derivation.bodyDigest(concept("", "a.md"));
			const text = concept(block(digest), "a.md");
			const out = yield* rerecordBodyDigest({ recorded: digest, before: text, after: text });
			assert.strictEqual(out.outcome, "untouched");
			assert.strictEqual(out.text, text);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("no recorded digest is untouched", () =>
		Effect.gen(function* () {
			const before = concept("", "a.md");
			const after = concept("", "b.md");
			const out = yield* rerecordBodyDigest({ recorded: undefined, before, after });
			assert.strictEqual(out.outcome, "untouched");
			assert.strictEqual(out.text, after);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("an integrity block it cannot edit is unrecordable, never forged", () =>
		Effect.gen(function* () {
			const digest = yield* Derivation.bodyDigest(concept("", "a.md"));
			const flow = `x-okfit-integrity: { generated: { body: ${digest} } }\n`;
			const before = concept(flow, "a.md");
			const after = concept(flow, "b.md");
			const out = yield* rerecordBodyDigest({ recorded: digest, before, after });
			assert.strictEqual(out.outcome, "unrecordable");
			assert.strictEqual(out.text, after);
		}).pipe(Effect.provide(TestPlatform)),
	);
});
