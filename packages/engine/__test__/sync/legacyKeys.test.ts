import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { FrontmatterSource, MarkdownDocument, MarkdownEdit, MarkdownParseOptions } from "@effected/markdown";
import { YamlDocument } from "@effected/yaml";
import { Concept, ConceptId, LoadedConcept, OkfitConfig } from "@okfit/core";
import { ProfileKeys } from "@okfit/profiles";
import { Effect, Option, Result } from "effect";
import type { KeyRenames } from "../../src/sync/legacyKeys.js";
import {
	LEGACY_INTEGRITY_KEY,
	keyRenamesFor,
	legacyIntegrity,
	planKeyRenames,
	recordedBodyForSync,
} from "../../src/sync/legacyKeys.js";

const DIR = join(import.meta.dirname, "..", "fixtures", "sync", "legacy-keys");
const read = (name: string): string => readFileSync(join(DIR, name), "utf8");

const RENAMES: KeyRenames = {
	integrity: { from: "integrity", to: "x-okfit-integrity" },
	fields: new Map([["Module", [{ from: "kind", to: "x-okfit-kind" }]]]),
};
const NAMES = { ...ProfileKeys, kind: "x-okfit-kind" } as const;

const field = { description: "d" };
const config = (types: Record<string, { fields?: Record<string, typeof field> }>): OkfitConfig =>
	OkfitConfig.merge(OkfitConfig.DEFAULTS, { extensions: {}, types });

/** The frontmatter as a plain mapping, without decoding it (a foreign `integrity` would not decode). */
const rawFrontmatter = (text: string) =>
	Effect.gen(function* () {
		const doc = yield* YamlDocument.parse(FrontmatterSource.split(text).frontmatter?.value ?? "");
		return doc.contents?.toValue() as Record<string, unknown>;
	});

/** A loaded concept whose frontmatter is the fixture's; the document is unused by the planner. */
const conceptOf = (text: string) =>
	Effect.gen(function* () {
		const raw = yield* rawFrontmatter(text);
		const frontmatter = Concept.make({ type: String(raw.type), extensions: {}, raw });
		return LoadedConcept.make({
			id: Option.getOrThrow(ConceptId.normalize("thing.md")),
			path: "thing.md",
			frontmatter,
			document: Result.getOrThrow(MarkdownDocument.parseResult("", MarkdownParseOptions.make({ frontmatter: true }))),
			computationBody: Option.none(),
		});
	});

const plan = (name: string) =>
	Effect.gen(function* () {
		const text = read(name);
		return { text, plan: yield* planKeyRenames(text, yield* conceptOf(text), RENAMES) };
	});

const applied = (name: string) =>
	Effect.gen(function* () {
		const { text, plan: p } = yield* plan(name);
		if (p._tag !== "edits") throw new Error(`expected edits, got ${p._tag}`);
		return { text, out: MarkdownEdit.applyAll(text, p.edits), keys: p.keys };
	});

describe("keyRenamesFor", () => {
	it("maps a declared target spelling on a type", () => {
		const out = keyRenamesFor(config({ Module: { fields: { "x-okfit-kind": field } } }), NAMES);
		assert.deepStrictEqual(out.fields.get("Module"), [{ from: "kind", to: "x-okfit-kind" }]);
	});

	it("keeps a user's own bare kind (Review Focus 2)", () => {
		const out = keyRenamesFor(config({ Module: { fields: { "x-okfit-kind": field, kind: field } } }), NAMES);
		assert.isFalse(out.fields.has("Module"));
	});

	it("renames nothing under profile none (no declared fields)", () => {
		assert.strictEqual(keyRenamesFor(config({ Module: {} }), NAMES).fields.size, 0);
	});

	it("leaves a custom type with no fields absent", () => {
		assert.isFalse(keyRenamesFor(config({ Widget: {} }), NAMES).fields.has("Widget"));
	});

	it("is empty for the production config today", () => {
		const out = keyRenamesFor(config({ Module: { fields: { kind: field } } }));
		assert.strictEqual(out.integrity, undefined);
		assert.strictEqual(out.fields.size, 0);
		assert.strictEqual(LEGACY_INTEGRITY_KEY, "integrity");
	});
});

describe("planKeyRenames", () => {
	it.effect("renames a plain key", () =>
		Effect.gen(function* () {
			const { text, out, keys } = yield* applied("plain.md");
			assert.strictEqual(out, text.replace("kind: package", "x-okfit-kind: package"));
			assert.deepStrictEqual(keys, ["kind"]);
		}),
	);

	it.effect("keeps a single-quoted key's quotes (the span includes them)", () =>
		Effect.gen(function* () {
			const { text, out } = yield* applied("quoted.md");
			assert.strictEqual(out, text.replace("'kind'", "'x-okfit-kind'"));
		}),
	);

	it.effect("keeps an anchor and a trailing comment", () =>
		Effect.gen(function* () {
			const { text, out } = yield* applied("anchored.md");
			assert.strictEqual(out, text.replace("kind:", "x-okfit-kind:"));
		}),
	);

	it.effect("renames only the integrity key token, leaving verified bytes alone", () =>
		Effect.gen(function* () {
			const { text, out, keys } = yield* applied("block-both.md");
			assert.strictEqual(out, text.replace("\nintegrity:", "\nx-okfit-integrity:"));
			assert.deepStrictEqual(keys, ["integrity"]);
		}),
	);

	it.effect("reports both spellings of a field as a conflict", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* plan("conflict-field.md")).plan, { _tag: "conflict", keys: ["kind"] });
		}),
	);

	it.effect("reports both integrity spellings as a conflict", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* plan("conflict-integrity.md")).plan, { _tag: "conflict", keys: ["integrity"] });
		}),
	);

	it.effect("refuses a flow-style document", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* plan("flow-document.md")).plan, { _tag: "unsupported", shape: "flow-document" });
		}),
	);

	it.effect("refuses a document with a merge key", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* plan("merge-key.md")).plan, { _tag: "unsupported", shape: "merge-key" });
		}),
	);

	it.effect("refuses a flow-mapping legacy integrity", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* plan("flow-integrity.md")).plan, { _tag: "unsupported", shape: "flow-mapping" });
		}),
	);

	it.effect("leaves a foreign scalar integrity alone (D2)", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* plan("foreign-integrity.md")).plan, { _tag: "none" });
		}),
	);

	it.effect("leaves url alone on a type that does not declare the new spelling", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* plan("url-undeclared.md")).plan, { _tag: "none" });
		}),
	);

	it.effect("is idempotent: planning the output again is none", () =>
		Effect.gen(function* () {
			const { out } = yield* applied("block-both.md");
			const again = yield* planKeyRenames(out, yield* conceptOf(out), RENAMES);
			assert.deepStrictEqual(again, { _tag: "none" });
			const { out: plainOut } = yield* applied("plain.md");
			assert.deepStrictEqual(yield* planKeyRenames(plainOut, yield* conceptOf(plainOut), RENAMES), { _tag: "none" });
		}),
	);
});

describe("recordedBodyForSync", () => {
	const withRaw = (raw: Record<string, unknown>) =>
		LoadedConcept.make({
			id: Option.getOrThrow(ConceptId.normalize("thing.md")),
			path: "thing.md",
			frontmatter: Concept.make({ type: "Module", extensions: {}, raw }),
			document: Result.getOrThrow(MarkdownDocument.parseResult("", MarkdownParseOptions.make({ frontmatter: true }))),
			computationBody: Option.none(),
		});

	it("reads the legacy block's body when it is the only record", () => {
		const concept = withRaw({ integrity: { generated: { body: "47fef58df84c6eb2" } } });
		assert.strictEqual(recordedBodyForSync(concept, RENAMES), "47fef58df84c6eb2");
		assert.strictEqual(legacyIntegrity(concept, RENAMES)?.generated?.body, "47fef58df84c6eb2");
	});

	it("is undefined for a malformed legacy block", () => {
		const concept = withRaw({ integrity: { generated: { body: "zz" } } });
		assert.strictEqual(recordedBodyForSync(concept, RENAMES), undefined);
	});

	it("is undefined without a rename", () => {
		const concept = withRaw({ integrity: { generated: { body: "47fef58df84c6eb2" } } });
		assert.strictEqual(recordedBodyForSync(concept, { integrity: undefined, fields: new Map() }), undefined);
	});
});
