import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument, MarkdownEdit } from "@effected/markdown";
import type { Actor, ActorPattern } from "@okfit/core";
import {
	Bundle,
	Concept,
	ConceptId,
	Derive,
	Generated,
	Integrity,
	IntegrityGenerated,
	LoadedBundle,
	LoadedConcept,
	OkfitConfig,
} from "@okfit/core";
import type { BodyProvenance } from "@okfit/profiles";
import { Derivation, Trust } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Layer, Option, Path, Result } from "effect";
import type { GeneratedProvenance } from "../../src/sync/generated.js";
import { syncGenerated } from "../../src/sync/generated.js";
import { keyRenamesFor } from "../../src/sync/legacyKeys.js";
import {
	detectNewline,
	documentNewline,
	locateGenerated,
	locateGeneratedBlock,
	stripBom,
} from "../../src/verify/locate.js";
import { spliceGenerated, spliceGeneratedBlock } from "../../src/verify/splice.js";
import { ROOT, seedPlatform } from "../utils/bundle.js";
import { TestPlatform } from "../utils/platform.js";

const RENAMES = keyRenamesFor(OkfitConfig.DEFAULTS);

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "sync", "generated");

/** The fixture's committed bytes, verbatim. */
const read = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

/** `locateGenerated` over the BOM-stripped text, which is what `syncGenerated` feeds it. */
const locateFixture = (name: string) => locateGenerated(stripBom(read(name)).text);

const ENCODED_AT = "2026-09-07T20:49:08Z";

describe("locateGenerated", () => {
	it.effect("classifies only-by.md as insertAfterLastKey and points at the line after by", () =>
		Effect.gen(function* () {
			const source = read("only-by.md");
			const located = yield* locateGenerated(source);
			assert.strictEqual(located._tag, "insertAfterLastKey");
			if (located._tag !== "insertAfterLastKey") return;
			assert.strictEqual(located.indent, "  ");
			assert.strictEqual(source.slice(located.insertAt, located.insertAt + 14), "status: stable");
		}),
	);

	it.effect("classifies plain-at.md as replaceScalar spanning the plain at value with no quote", () =>
		Effect.gen(function* () {
			const source = read("plain-at.md");
			const located = yield* locateGenerated(source);
			assert.strictEqual(located._tag, "replaceScalar");
			if (located._tag !== "replaceScalar") return;
			assert.strictEqual(located.quote, "plain");
			assert.strictEqual(source.slice(located.start, located.end), "2026-01-02T00:00:00Z");
		}),
	);

	it.effect(
		"classifies quoted-at-single.md as replaceScalar spanning the single-quoted value including its quotes",
		() =>
			Effect.gen(function* () {
				const source = read("quoted-at-single.md");
				const located = yield* locateGenerated(source);
				assert.strictEqual(located._tag, "replaceScalar");
				if (located._tag !== "replaceScalar") return;
				assert.strictEqual(located.quote, "single-quoted");
				assert.strictEqual(source.slice(located.start, located.end), "'2026-01-02T00:00:00Z'");
			}),
	);

	it.effect(
		"classifies quoted-at-double.md as replaceScalar spanning the double-quoted value including its quotes",
		() =>
			Effect.gen(function* () {
				const source = read("quoted-at-double.md");
				const located = yield* locateGenerated(source);
				assert.strictEqual(located._tag, "replaceScalar");
				if (located._tag !== "replaceScalar") return;
				assert.strictEqual(located.quote, "double-quoted");
				assert.strictEqual(source.slice(located.start, located.end), '"2026-01-02T00:00:00Z"');
			}),
	);

	it.effect("classifies at-before-by.md as replaceScalar, finding at by key name rather than declaration order", () =>
		Effect.gen(function* () {
			const source = read("at-before-by.md");
			const located = yield* locateGenerated(source);
			assert.strictEqual(located._tag, "replaceScalar");
			if (located._tag !== "replaceScalar") return;
			assert.strictEqual(located.quote, "plain");
			assert.strictEqual(source.slice(located.start, located.end), "2026-01-02T00:00:00Z");
		}),
	);

	it.effect("classifies trailing-comment.md as insertAfterLastKey with the comment left outside the span", () =>
		Effect.gen(function* () {
			const source = read("trailing-comment.md");
			const located = yield* locateGenerated(source);
			assert.strictEqual(located._tag, "insertAfterLastKey");
			if (located._tag !== "insertAfterLastKey") return;
			assert.strictEqual(located.indent, "  ");
			assert.isTrue(source.slice(located.insertAt).startsWith("# trailing comment on generated"));
			assert.isTrue(source.slice(0, located.insertAt).includes("by: human:spencer"));
		}),
	);

	it.effect("classifies flow.md as unsupported with shape flow-mapping", () =>
		Effect.gen(function* () {
			const located = yield* locateFixture("flow.md");
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "flow-mapping" });
		}),
	);

	it.effect(
		"classifies absent.md as unsupported when locateGenerated is called directly, since the caller-level generated-missing check runs first in practice",
		() =>
			Effect.gen(function* () {
				const located = yield* locateFixture("absent.md");
				assert.strictEqual(located._tag, "unsupported");
			}),
	);

	it.effect("classifies empty.md as unsupported with shape empty", () =>
		Effect.gen(function* () {
			const located = yield* locateFixture("empty.md");
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "empty" });
		}),
	);

	it.effect("classifies crlf.md as insertAfterLastKey and reports CRLF as the document newline", () =>
		Effect.gen(function* () {
			const source = read("crlf.md");
			assert.strictEqual(documentNewline(source), "\r\n");
			assert.strictEqual(detectNewline(source), "\r\n");
			const located = yield* locateGenerated(source);
			assert.strictEqual(located._tag, "insertAfterLastKey");
			if (located._tag !== "insertAfterLastKey") return;
			assert.strictEqual(source.slice(located.insertAt, located.insertAt + 14), "status: stable");
		}),
	);

	it.effect("classifies bom.md as insertAfterLastKey with offsets computed on the BOM-stripped text", () =>
		Effect.gen(function* () {
			const raw = read("bom.md");
			assert.strictEqual(raw.charCodeAt(0), 0xfeff);
			const { text, bom } = stripBom(raw);
			assert.strictEqual(bom, "﻿");
			assert.strictEqual(text, read("only-by.md"));
			const located = yield* locateGenerated(text);
			assert.strictEqual(located._tag, "insertAfterLastKey");
		}),
	);

	it.effect("classifies at-not-scalar.md as unsupported with shape at-not-scalar", () =>
		Effect.gen(function* () {
			const located = yield* locateFixture("at-not-scalar.md");
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "at-not-scalar" });
		}),
	);
});

describe("locateGeneratedBlock", () => {
	it.effect("classifies no-generated.md as absent, pointing at the end of the frontmatter value", () =>
		Effect.gen(function* () {
			const source = read("no-generated.md");
			const located = yield* locateGeneratedBlock(source);
			assert.strictEqual(located._tag, "absent");
			if (located._tag !== "absent") return;
			// The insertion point is the byte before the closing fence line.
			assert.strictEqual(source.slice(located.insertAt, located.insertAt + 4), "---\n");
		}),
	);

	it.effect("classifies only-by.md as unsupported (a generated key already exists)", () =>
		Effect.gen(function* () {
			const located = yield* locateGeneratedBlock(read("only-by.md"));
			assert.strictEqual(located._tag, "unsupported");
		}),
	);

	for (const spelling of ["generated:", "generated: ~", "generated: null"]) {
		it.effect(`classifies a null-valued \`${spelling}\` as replaceable, spanning exactly that line (#144)`, () =>
			Effect.gen(function* () {
				const source = `---\ntype: Module\n${spelling}\ntitle: T\n---\n\nBody.\n`;
				const located = yield* locateGeneratedBlock(source);
				assert.strictEqual(located._tag, "replace");
				if (located._tag !== "replace") return;
				assert.strictEqual(source.slice(located.start, located.end), `${spelling}\n`);
			}),
		);
	}

	for (const [name, source, line] of [
		["NULL", "---\ntype: Module\ngenerated: NULL\ntitle: T\n---\n", "generated: NULL\n"],
		["a trailing comment", "---\ntype: Module\ngenerated: ~ # todo\ntitle: T\n---\n", "generated: ~ # todo\n"],
		["CRLF", "---\r\ntype: Module\r\ngenerated: ~\r\ntitle: T\r\n---\r\n", "generated: ~\r\n"],
		["a value on the next line", "---\ntype: Module\ngenerated:\n  ~\ntitle: T\n---\n", "generated:\n  ~\n"],
		["the last key", "---\ntype: Module\ngenerated: ~\n---\n", "generated: ~\n"],
		["a quoted key", '---\ntype: Module\n"generated": ~\ntitle: T\n---\n', '"generated": ~\n'],
	] as const) {
		it.effect(`classifies ${name} as replaceable`, () =>
			Effect.gen(function* () {
				const located = yield* locateGeneratedBlock(source);
				assert.strictEqual(located._tag, "replace");
				if (located._tag !== "replace") return;
				assert.strictEqual(source.slice(located.start, located.end), line);
			}),
		);
	}

	for (const spelling of ["generated: !!null", "generated: &a ~", "generated: !!null ~", "generated: &a"]) {
		it.effect(`classifies a tagged or anchored \`${spelling}\` as unsupported`, () =>
			Effect.gen(function* () {
				const located = yield* locateGeneratedBlock(`---\ntype: Module\n${spelling}\ntitle: T\n---\n`);
				assert.strictEqual(located._tag, "unsupported");
			}),
		);
	}

	it.effect("still treats a non-null generated value as unsupported", () =>
		Effect.gen(function* () {
			const located = yield* locateGeneratedBlock("---\ntype: Module\ngenerated: nope\n---\n");
			assert.strictEqual(located._tag, "unsupported");
		}),
	);
});

describe("spliceGeneratedBlock", () => {
	it.effect("inserts a three-line block mapping as the last top-level key", () =>
		Effect.gen(function* () {
			const source = read("no-generated.md");
			const located = yield* locateGeneratedBlock(source);
			if (located._tag !== "absent") return assert.fail("expected absent");
			const edit = spliceGeneratedBlock(located, { by: "okfit/claude-code", at: ENCODED_AT }, "\n");
			const out = MarkdownEdit.applyAll(source, [edit]);
			assert.strictEqual(
				out,
				[
					"---",
					"type: Module",
					"title: No generated",
					"status: stable",
					"generated:",
					"  by: okfit/claude-code",
					`  at: ${ENCODED_AT}`,
					"---",
					"",
					"# No generated",
					"",
					"Body.",
					"",
				].join("\n"),
			);
		}),
	);
});

describe("spliceGenerated", () => {
	const WRITABLE = [
		"only-by.md",
		"plain-at.md",
		"quoted-at-single.md",
		"quoted-at-double.md",
		"at-before-by.md",
		"trailing-comment.md",
		"crlf.md",
		"bom.md",
	] as const;

	for (const name of WRITABLE) {
		it.effect(`${name}: produces exactly one edit that leaves every other byte alone`, () =>
			Effect.gen(function* () {
				const raw = read(name);
				const { text, bom } = stripBom(raw);
				const located = yield* locateGenerated(text);
				assert.notStrictEqual(located._tag, "unsupported");
				if (located._tag === "unsupported") throw new Error(`unexpected unsupported shape ${located.shape}`);
				const newline = documentNewline(text);
				const edit = spliceGenerated(located, ENCODED_AT, newline);
				const applied = bom + MarkdownEdit.applyAll(text, [edit]);
				const body = applied.slice(bom.length);
				assert.strictEqual(body.slice(0, edit.offset), text.slice(0, edit.offset));
				assert.strictEqual(body.slice(edit.offset + edit.content.length), text.slice(edit.offset + edit.length));
			}),
		);
	}

	it.effect("only-by.md: inserts at: 2026-09-07T20:49:08Z as its own line directly after by, before status", () =>
		Effect.gen(function* () {
			const source = read("only-by.md");
			const located = yield* locateGenerated(source);
			if (located._tag !== "insertAfterLastKey") throw new Error("expected insertAfterLastKey");
			const edit = spliceGenerated(located, ENCODED_AT, "\n");
			const applied = MarkdownEdit.applyAll(source, [edit]);
			assert.strictEqual(
				applied,
				[
					"---",
					"type: Decision",
					"title: Generated with only by",
					"description: generated has by but no at yet.",
					"generated:",
					"  by: human:spencer",
					"  at: 2026-09-07T20:49:08Z",
					"status: stable",
					"---",
					"",
					"# Generated with only by",
					"",
				].join("\n"),
			);
		}),
	);

	it.effect("trailing-comment.md: the inserted at line lands above the comment, which survives verbatim", () =>
		Effect.gen(function* () {
			const source = read("trailing-comment.md");
			const located = yield* locateGenerated(source);
			if (located._tag !== "insertAfterLastKey") throw new Error("expected insertAfterLastKey");
			const edit = spliceGenerated(located, ENCODED_AT, "\n");
			const applied = MarkdownEdit.applyAll(source, [edit]);
			assert.isTrue(applied.includes("  at: 2026-09-07T20:49:08Z\n# trailing comment on generated\n"));
		}),
	);

	it.effect("plain-at.md: replaces the plain scalar without introducing a quote", () =>
		Effect.gen(function* () {
			const source = read("plain-at.md");
			const located = yield* locateGenerated(source);
			if (located._tag !== "replaceScalar") throw new Error("expected replaceScalar");
			const edit = spliceGenerated(located, ENCODED_AT, "\n");
			const applied = MarkdownEdit.applyAll(source, [edit]);
			assert.isTrue(applied.includes("  at: 2026-09-07T20:49:08Z\n"));
			assert.isFalse(applied.includes("2026-01-02T00:00:00Z"));
		}),
	);

	it.effect("quoted-at-single.md: replaces the value and keeps the single-quote style", () =>
		Effect.gen(function* () {
			const source = read("quoted-at-single.md");
			const located = yield* locateGenerated(source);
			if (located._tag !== "replaceScalar") throw new Error("expected replaceScalar");
			const edit = spliceGenerated(located, ENCODED_AT, "\n");
			const applied = MarkdownEdit.applyAll(source, [edit]);
			assert.isTrue(applied.includes("  at: '2026-09-07T20:49:08Z'\n"));
		}),
	);

	it.effect("quoted-at-double.md: replaces the value and keeps the double-quote style", () =>
		Effect.gen(function* () {
			const source = read("quoted-at-double.md");
			const located = yield* locateGenerated(source);
			if (located._tag !== "replaceScalar") throw new Error("expected replaceScalar");
			const edit = spliceGenerated(located, ENCODED_AT, "\n");
			const applied = MarkdownEdit.applyAll(source, [edit]);
			assert.isTrue(applied.includes('  at: "2026-09-07T20:49:08Z"\n'));
		}),
	);

	it.effect("crlf.md: every inserted line terminator is CRLF and no bare LF appears in the output", () =>
		Effect.gen(function* () {
			const source = read("crlf.md");
			const located = yield* locateGenerated(source);
			if (located._tag !== "insertAfterLastKey") throw new Error("expected insertAfterLastKey");
			const edit = spliceGenerated(located, ENCODED_AT, "\r\n");
			assert.isTrue(edit.content.includes("\r\n"));
			const applied = MarkdownEdit.applyAll(source, [edit]);
			assert.strictEqual(applied.replace(/\r\n/g, "").indexOf("\n"), -1);
		}),
	);

	it.effect("bom.md: the spliced output begins with U+FEFF and the remainder equals only-by.md's own splice", () =>
		Effect.gen(function* () {
			const withBomRaw = read("bom.md");
			const { text: withBomText, bom } = stripBom(withBomRaw);
			const withBomLocated = yield* locateGenerated(withBomText);
			if (withBomLocated._tag !== "insertAfterLastKey") throw new Error("expected insertAfterLastKey");
			const withBomEdit = spliceGenerated(withBomLocated, ENCODED_AT, "\n");
			const withBomApplied = bom + MarkdownEdit.applyAll(withBomText, [withBomEdit]);

			const withoutBomText = read("only-by.md");
			const withoutBomLocated = yield* locateGenerated(withoutBomText);
			if (withoutBomLocated._tag !== "insertAfterLastKey") throw new Error("expected insertAfterLastKey");
			const withoutBomEdit = spliceGenerated(withoutBomLocated, ENCODED_AT, "\n");
			const withoutBomApplied = MarkdownEdit.applyAll(withoutBomText, [withoutBomEdit]);

			assert.strictEqual(withBomApplied.charCodeAt(0), 0xfeff);
			assert.strictEqual(withBomApplied.slice(1), withoutBomApplied);
		}),
	);

	it.effect("flow.md, absent.md, empty.md, at-not-scalar.md: all refuse with unsupported and produce no edit", () =>
		Effect.gen(function* () {
			for (const name of ["flow.md", "absent.md", "empty.md", "at-not-scalar.md"] as const) {
				const located = yield* locateFixture(name);
				assert.strictEqual(located._tag, "unsupported");
			}
		}),
	);
});

describe("syncGenerated: body-digest design (issue #19)", () => {
	const DERIVED_AT = DateTime.makeUnsafe("2026-06-01T08:00:00Z");
	const ENCODED_DERIVED_AT = "2026-06-01T08:00:00Z";
	const SOURCE = ["---", "type: Module", "title: Digested", "---", "", "# Digested", "", "Body text.", ""].join("\n");
	const OTHER_SOURCE = ["---", "type: Module", "title: Digested", "---", "", "# Digested", "", "New body.", ""].join(
		"\n",
	);
	const digestOf = (source: string) => Effect.provide(Derivation.bodyDigest(source), TestPlatform);

	const committed: BodyProvenance = {
		_tag: "committed",
		at: DERIVED_AT,
		sha: "0123456789abcdef0123456789abcdef01234567",
		committedAt: DERIVED_AT,
		authorName: "Author",
		authorEmail: "author@example.com",
		creating: false,
	};

	const conceptWith = (source: string, generated: Generated, integrity?: Integrity): LoadedConcept =>
		LoadedConcept.make({
			id: Option.getOrThrow(ConceptId.normalize("module.md")),
			path: "module.md",
			frontmatter: Concept.make({
				type: "Module",
				extensions: {},
				raw: {},
				generated,
				...(integrity === undefined ? {} : { integrity }),
			}),
			document: Result.getOrThrow(MarkdownDocument.parseResult(source)),
			computationBody: Option.none(),
		});

	const bundleWith = (concept: LoadedConcept, root: string): LoadedBundle =>
		LoadedBundle.make({
			root,
			files: [concept.path],
			directories: [""],
			concepts: new Map([[concept.id, concept]]),
			indexes: new Map(),
			logs: new Map(),
			diagnostics: [],
		});

	it.effect("reports unchanged and touches no file when the recorded digest matches the current body", () =>
		Effect.gen(function* () {
			const digest = yield* digestOf(SOURCE);
			const concept = conceptWith(
				SOURCE,
				Generated.make({ by: "human:okfit-test" }),
				Integrity.make({ generated: IntegrityGenerated.make({ body: digest }) }),
			);
			const bundle = bundleWith(concept, "/repo");
			const result = yield* syncGenerated(bundle, {
				provenance: new Map([[concept.id, committed]]),
				renames: RENAMES,
				dryRun: false,
			}).pipe(
				// Fails any file read/write (the noop is last, so it shadows NodeServices' FileSystem): proves the unchanged branch never reaches step 7 at all.
				Effect.provide([TestPlatform, FileSystem.layerNoop({}), Path.layer]),
			);
			assert.deepStrictEqual(result.written, []);
			assert.deepStrictEqual(result.unchanged, [concept.id]);
			assert.deepStrictEqual(result.migrated, []);
			assert.deepStrictEqual(result.skipped, []);
		}),
	);

	it.effect(
		"drift on a legacy concept: re-stamps at, moves the digest to integrity, and reports written and migrated",
		() =>
			Effect.gen(function* () {
				const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-generated-")));
				try {
					const staleDigest = yield* digestOf(SOURCE);
					const text = SOURCE.replace(
						"title: Digested",
						`title: Digested\ngenerated:\n  by: human:okfit-test\n  at: 2020-01-01T00:00:00Z\n  body_sha256: ${staleDigest}`,
					);
					yield* Effect.promise(() => writeFile(join(dir, "module.md"), text));
					const concept = conceptWith(
						OTHER_SOURCE,
						Generated.make({ by: "human:okfit-test", body_sha256: staleDigest }),
					);
					const bundle = bundleWith(concept, dir);
					const result = yield* syncGenerated(bundle, {
						provenance: new Map([[concept.id, committed]]),
						renames: RENAMES,
						dryRun: false,
					}).pipe(Effect.provide(TestPlatform));
					assert.deepStrictEqual(result.written, [concept.id]);
					assert.deepStrictEqual(result.migrated, [concept.id]);
					const written = yield* Effect.promise(() => readFile(join(dir, "module.md"), "utf8"));
					assert.include(written, `at: ${ENCODED_DERIVED_AT}`);
					const currentDigest = yield* digestOf(OTHER_SOURCE);
					assert.notInclude(written, "body_sha256");
					assert.include(written, `x-okfit-integrity:\n  generated:\n    body: ${currentDigest}\n`);
				} finally {
					yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
				}
			}),
	);

	it.effect("a malformed integrity block whose rewrite changes no byte reports unchanged and writes nothing", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-generated-")));
			try {
				const digest = yield* digestOf(SOURCE);
				// The parsed concept carries no integrity (the block does not decode: `verified: nope`),
				// yet the file already holds the stamp and digest sync would write.
				const text = SOURCE.replace(
					"title: Digested",
					`title: Digested\ngenerated:\n  by: human:okfit-test\n  at: ${ENCODED_DERIVED_AT}\nx-okfit-integrity:\n  generated:\n    body: ${digest}\n  verified: nope`,
				);
				const file = join(dir, "module.md");
				yield* Effect.promise(() => writeFile(file, text));
				const concept = conceptWith(SOURCE, Generated.make({ by: "human:okfit-test" }));
				const pending: Array<{ readonly target: string; readonly contents: string }> = [];
				const dry = yield* syncGenerated(bundleWith(concept, dir), {
					provenance: new Map([[concept.id, committed]]),
					renames: RENAMES,
					dryRun: true,
					pending,
				}).pipe(Effect.provide(TestPlatform));
				assert.deepStrictEqual(dry.written, []);
				assert.deepStrictEqual(dry.unchanged, [concept.id]);
				assert.deepStrictEqual(pending, []);
				const result = yield* syncGenerated(bundleWith(concept, dir), {
					provenance: new Map([[concept.id, committed]]),
					renames: RENAMES,
					dryRun: false,
				}).pipe(Effect.provide(TestPlatform));
				assert.deepStrictEqual(result.written, []);
				assert.deepStrictEqual(result.migrated, []);
				assert.deepStrictEqual(result.unchanged, [concept.id]);
				assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), text);
			} finally {
				yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("stamps at and integrity, preserving quote style and newline style, when no digest is recorded", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-generated-")));
			try {
				const text = [
					"---",
					"type: Module",
					"title: Digested",
					"generated:",
					"  by: human:okfit-test",
					"  at: '2020-01-01T00:00:00Z'",
					"---",
					"",
					"# Digested",
					"",
					"Body text.",
					"",
				].join("\n");
				yield* Effect.promise(() => writeFile(join(dir, "module.md"), text));
				const concept = conceptWith(SOURCE, Generated.make({ by: "human:okfit-test" }));
				const bundle = bundleWith(concept, dir);
				const result = yield* syncGenerated(bundle, {
					provenance: new Map([[concept.id, committed]]),
					renames: RENAMES,
					dryRun: false,
				}).pipe(Effect.provide(TestPlatform));
				assert.deepStrictEqual(result.written, [concept.id]);
				const written = yield* Effect.promise(() => readFile(join(dir, "module.md"), "utf8"));
				assert.include(written, `at: '${ENCODED_DERIVED_AT}'`); // single-quote style preserved
				const currentDigest = yield* digestOf(SOURCE);
				assert.include(written, `x-okfit-integrity:\n  generated:\n    body: ${currentDigest}\n`);
				assert.notInclude(written, "\r\n"); // LF document stays LF
			} finally {
				yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
			}
		}),
	);

	it.effect(
		"inserts at and the integrity block together at the end of the frontmatter, oddly-indented generated block round-trips",
		() =>
			Effect.gen(function* () {
				const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-generated-")));
				try {
					const text = [
						"---",
						"type: Module",
						"title: Digested",
						"generated:",
						"    by: human:okfit-test",
						"---",
						"",
						"# Digested",
						"",
						"Body text.",
						"",
					].join("\n");
					yield* Effect.promise(() => writeFile(join(dir, "module.md"), text));
					const concept = conceptWith(SOURCE, Generated.make({ by: "human:okfit-test" }));
					const bundle = bundleWith(concept, dir);
					const result = yield* syncGenerated(bundle, {
						provenance: new Map([[concept.id, committed]]),
						renames: RENAMES,
						dryRun: false,
					}).pipe(Effect.provide(TestPlatform));
					assert.deepStrictEqual(result.written, [concept.id]);
					const written = yield* Effect.promise(() => readFile(join(dir, "module.md"), "utf8"));
					assert.include(written, `    at: ${ENCODED_DERIVED_AT}`);
					const currentDigest = yield* digestOf(SOURCE);
					assert.include(written, `x-okfit-integrity:\n  generated:\n    body: ${currentDigest}\n`);
				} finally {
					yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
				}
			}),
	);

	it.effect("creates the generated block from agent when the concept has none and the body is committed", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-create-")));
			try {
				yield* Effect.promise(() => writeFile(join(root, "module.md"), SOURCE));
				const concept = LoadedConcept.make({
					id: Option.getOrThrow(ConceptId.normalize("module.md")),
					path: "module.md",
					frontmatter: Concept.make({ type: "Module", extensions: {}, raw: {} }),
					document: Result.getOrThrow(MarkdownDocument.parseResult(SOURCE)),
					computationBody: Option.none(),
				});
				const bundle = bundleWith(concept, root);
				const result = yield* syncGenerated(bundle, {
					provenance: new Map([[concept.id, committed]]),
					renames: RENAMES,
					dryRun: false,
					agent: "okfit/claude-code" as Actor,
				});
				assert.deepStrictEqual(result.written, [concept.id]);
				const digest = yield* digestOf(SOURCE);
				const out = yield* Effect.promise(() => readFile(join(root, "module.md"), "utf8"));
				assert.strictEqual(
					out,
					[
						"---",
						"type: Module",
						"title: Digested",
						"generated:",
						"  by: okfit/claude-code",
						`  at: ${ENCODED_DERIVED_AT}`,
						"x-okfit-integrity:",
						"  generated:",
						`    body: ${digest}`,
						"---",
						"",
						"# Digested",
						"",
						"Body text.",
						"",
					].join("\n"),
				);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(TestPlatform)),
	);

	for (const spelling of ["generated:", "generated: ~"]) {
		it.effect(`replaces a null-valued \`${spelling}\` line with the full block from agent (#144)`, () =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-null-")));
				try {
					const nullSource = SOURCE.replace("title: Digested\n", `${spelling}\ntitle: Digested\n`);
					yield* Effect.promise(() => writeFile(join(root, "module.md"), nullSource));
					const concept = LoadedConcept.make({
						id: Option.getOrThrow(ConceptId.normalize("module.md")),
						path: "module.md",
						frontmatter: Concept.make({ type: "Module", extensions: {}, raw: {} }),
						document: Result.getOrThrow(MarkdownDocument.parseResult(nullSource)),
						computationBody: Option.none(),
					});
					const result = yield* syncGenerated(bundleWith(concept, root), {
						provenance: new Map([[concept.id, committed]]),
						renames: RENAMES,
						dryRun: false,
						agent: "okfit/claude-code" as Actor,
					});
					assert.deepStrictEqual(result.written, [concept.id]);
					assert.deepStrictEqual(result.skipped, []);
					const digest = yield* digestOf(nullSource);
					const out = yield* Effect.promise(() => readFile(join(root, "module.md"), "utf8"));
					assert.strictEqual(
						out,
						[
							"---",
							"type: Module",
							"generated:",
							"  by: okfit/claude-code",
							`  at: ${ENCODED_DERIVED_AT}`,
							"title: Digested",
							"x-okfit-integrity:",
							"  generated:",
							`    body: ${digest}`,
							"---",
							"",
							"# Digested",
							"",
							"Body text.",
							"",
						].join("\n"),
					);
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}).pipe(Effect.provide(TestPlatform)),
		);
	}

	it.effect("skips generated-missing when the concept has no block and no agent is configured", () =>
		Effect.gen(function* () {
			const concept = LoadedConcept.make({
				id: Option.getOrThrow(ConceptId.normalize("module.md")),
				path: "module.md",
				frontmatter: Concept.make({ type: "Module", extensions: {}, raw: {} }),
				document: Result.getOrThrow(MarkdownDocument.parseResult(SOURCE)),
				computationBody: Option.none(),
			});
			const result = yield* syncGenerated(bundleWith(concept, "/repo"), {
				provenance: new Map([[concept.id, committed]]),
				renames: RENAMES,
				dryRun: false,
			}).pipe(Effect.provide([TestPlatform, FileSystem.layerNoop({}), Path.layer]));
			assert.deepStrictEqual(result.skipped, [{ id: concept.id, reason: "generated-missing" }]);
		}),
	);

	it.effect("decides unchanged from the digest alone, with no provenance entry for the concept", () =>
		Effect.gen(function* () {
			const digest = yield* digestOf(SOURCE);
			const concept = conceptWith(
				SOURCE,
				Generated.make({ by: "human:okfit-test", at: DERIVED_AT }),
				Integrity.make({ generated: IntegrityGenerated.make({ body: digest }) }),
			);
			const result = yield* syncGenerated(bundleWith(concept, "/repo"), {
				provenance: new Map(),
				renames: RENAMES,
				dryRun: false,
			}).pipe(Effect.provide([TestPlatform, FileSystem.layerNoop({}), Path.layer]));
			assert.deepStrictEqual(result.unchanged, [concept.id]);
		}),
	);

	it.effect("omits concepts outside scope from every list", () =>
		Effect.gen(function* () {
			const concept = conceptWith(SOURCE, Generated.make({ by: "human:okfit-test" }));
			const result = yield* syncGenerated(bundleWith(concept, "/repo"), {
				provenance: new Map([[concept.id, committed]]),
				renames: RENAMES,
				dryRun: true,
				scope: new Set(),
			}).pipe(Effect.provide([TestPlatform, FileSystem.layerNoop({}), Path.layer]));
			assert.deepStrictEqual(result, { written: [], unchanged: [], migrated: [], skipped: [] });
		}),
	);
});

describe("syncGenerated: integrity and legacy migration", () => {
	const DERIVED_AT = DateTime.makeUnsafe("2026-06-01T08:00:00Z");
	const committed: BodyProvenance = {
		_tag: "committed",
		at: DERIVED_AT,
		sha: "0123456789abcdef0123456789abcdef01234567",
		committedAt: DERIVED_AT,
		authorName: "Author",
		authorEmail: "author@example.com",
		creating: false,
	};
	const BODY = "\n# Page\n\nBody text.\n";
	const OLD_AT = "2020-01-01T00:00:00Z";
	const VERIFIED =
		"x-okfit-integrity:\n  verified:\n    by: human:ada\n    at: 2026-02-02T02:02:02Z\n    content: bbbbbbbbbbbbbbbb\n";

	/** A one-concept bundle on disk; `frontmatter` is the text between the `type:` line and the closing fence. */
	const withFile = <A, E, R>(frontmatter: string, body: string, use: (root: string) => Effect.Effect<A, E, R>) =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-integrity-")));
			return yield* Effect.gen(function* () {
				yield* Effect.promise(() => writeFile(join(root, "page.md"), `---\ntype: Module\n${frontmatter}---${body}`));
				return yield* use(root);
			}).pipe(Effect.ensuring(Effect.promise(() => rm(root, { recursive: true, force: true }))));
		}).pipe(Effect.provide(TestPlatform));

	const run = (root: string, agent?: Actor) =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root });
			const provenance = new Map([...bundle.concepts.keys()].map((id) => [id, committed] as const));
			return yield* syncGenerated(bundle, {
				provenance,
				renames: RENAMES,
				dryRun: false,
				...(agent === undefined ? {} : { agent }),
			});
		});
	const digestOfBody = (frontmatter: string) => Derivation.bodyDigest(`---\ntype: Module\n${frontmatter}---${BODY}`);
	const readPage = (root: string) => Effect.promise(() => readFile(join(root, "page.md"), "utf8"));

	it.effect("migrate-only: a legacy digest that still matches moves to integrity without touching generated.at", () =>
		withFile(`generated:\n  by: human:ada\n  at: ${OLD_AT}\n  body_sha256: ${"0".repeat(64)}\n`, BODY, (root) =>
			Effect.gen(function* () {
				const digest = yield* digestOfBody("");
				yield* Effect.promise(() =>
					writeFile(
						join(root, "page.md"),
						`---\ntype: Module\ngenerated:\n  by: human:ada\n  at: ${OLD_AT}\n  body_sha256: ${digest}${"0".repeat(48)}\n---${BODY}`,
					),
				);
				const result = yield* run(root);
				assert.deepStrictEqual(result.migrated, ["page"]);
				assert.deepStrictEqual(result.written, []);
				assert.deepStrictEqual(result.unchanged, []);
				assert.strictEqual(
					yield* readPage(root),
					`---\ntype: Module\ngenerated:\n  by: human:ada\n  at: ${OLD_AT}\nx-okfit-integrity:\n  generated:\n    body: ${digest}\n---${BODY}`,
				);
			}),
		),
	);

	it.effect("a kept generated with an offset-less at ends with exactly one at line after sync (tolerant reading)", () =>
		withFile("generated:\n  by: human:ada\n  at: 2026-06-30T14:00:00\n", BODY, (root) =>
			Effect.gen(function* () {
				const result = yield* run(root);
				assert.deepStrictEqual(result.written, ["page"]);
				const text = yield* readPage(root);
				assert.strictEqual(text.split("\n").filter((line) => /^\s*at:/.test(line)).length, 1);
				assert.include(text, `at: ${"2026-06-01T08:00:00Z"}`);
				assert.notInclude(text, "2026-06-30T14:00:00\n");
			}),
		),
	);

	it.effect(
		"a generated with no by reads as absent; with an agent set it is skipped generated-unsupported, unwritten",
		() =>
			withFile("generated:\n  at: 2026-06-30T14:00:00Z\n", BODY, (root) =>
				Effect.gen(function* () {
					const before = yield* readPage(root);
					const result = yield* run(root, "okfit/claude-code" as Actor);
					assert.deepStrictEqual(result.skipped, [{ id: "page", reason: "generated-unsupported" }]);
					assert.deepStrictEqual(result.written, []);
					assert.strictEqual(yield* readPage(root), before);
				}),
			),
	);

	it.effect("idempotent: a second run reports everything unchanged with nothing migrated", () =>
		withFile(`generated:\n  by: human:ada\n  at: ${OLD_AT}\n  body_sha256: ${"a".repeat(64)}\n`, BODY, (root) =>
			Effect.gen(function* () {
				const first = yield* run(root);
				assert.deepStrictEqual(first.written, ["page"]);
				assert.deepStrictEqual(first.migrated, ["page"]);
				const afterFirst = yield* readPage(root);
				const second = yield* run(root);
				assert.deepStrictEqual(second.written, []);
				assert.deepStrictEqual(second.migrated, []);
				assert.deepStrictEqual(second.unchanged, ["page"]);
				assert.strictEqual(yield* readPage(root), afterFirst);
			}),
		),
	);

	it.effect("a fresh concept gets the generated block and an integrity block, no body_sha256", () =>
		withFile("", BODY, (root) =>
			Effect.gen(function* () {
				const result = yield* run(root, "okfit/claude-code" as Actor);
				assert.deepStrictEqual(result.written, ["page"]);
				assert.deepStrictEqual(result.migrated, []);
				const digest = yield* digestOfBody("");
				assert.strictEqual(
					yield* readPage(root),
					`---\ntype: Module\ngenerated:\n  by: okfit/claude-code\n  at: 2026-06-01T08:00:00Z\nx-okfit-integrity:\n  generated:\n    body: ${digest}\n---${BODY}`,
				);
			}),
		),
	);

	it.effect("keeps integrity.verified byte-identical across a drift re-stamp", () =>
		withFile(
			`generated:\n  by: human:ada\n  at: ${OLD_AT}\n${VERIFIED.replace("x-okfit-integrity:\n", "x-okfit-integrity:\n  generated:\n    body: 0000000000000000\n")}`,
			BODY,
			(root) =>
				Effect.gen(function* () {
					const result = yield* run(root);
					assert.deepStrictEqual(result.written, ["page"]);
					const out = yield* readPage(root);
					assert.include(
						out,
						"  verified:\n    by: human:ada\n    at: 2026-02-02T02:02:02Z\n    content: bbbbbbbbbbbbbbbb\n",
					);
					const digest = yield* digestOfBody("");
					assert.include(out, `  generated:\n    body: ${digest}\n`);
					assert.include(out, "at: 2026-06-01T08:00:00Z");
				}),
		),
	);

	it.effect(
		"leaves the verified slot and unknown integrity keys byte-identical (offset, quoting) on a drift re-stamp",
		() => {
			const slot =
				"  note: keep me\n  verified:\n    by: human:ada\n    at: 2026-10-10T20:00:00+02:00\n    content: 'bbbbbbbbbbbbbbbb'\n";
			return withFile(
				`generated:\n  by: human:ada\n  at: ${OLD_AT}\nx-okfit-integrity:\n  generated:\n    body: 0000000000000000\n${slot}`,
				BODY,
				(root) =>
					Effect.gen(function* () {
						const result = yield* run(root);
						assert.deepStrictEqual(result.written, ["page"]);
						const out = yield* readPage(root);
						assert.include(out, slot);
						const digest = yield* digestOfBody("");
						assert.include(out, `x-okfit-integrity:\n  generated:\n    body: ${digest}\n${slot}`);
					}),
			);
		},
	);

	it.effect("adds the generated slot ahead of an existing verified-only integrity block", () =>
		withFile(`generated:\n  by: human:ada\n  at: ${OLD_AT}\n${VERIFIED}`, BODY, (root) =>
			Effect.gen(function* () {
				yield* run(root);
				const digest = yield* digestOfBody("");
				const out = yield* readPage(root);
				assert.include(out, `x-okfit-integrity:\n  generated:\n    body: ${digest}\n  verified:\n    by: human:ada\n`);
			}),
		),
	);

	it.effect(
		"migrates legacy renders[].body_sha256 of a Publication whose body is unchanged, then is idempotent",
		() => {
			const LEGACY = "abcdef0123456789".repeat(4);
			const renders = (entries: string) => `type: Publication\nresource: page.md\nsurface: s\nrenders:\n${entries}`;
			const legacyRenders = `  - path: a.md\n    body_sha256: ${LEGACY}\n  - path: b.md\n    body: 1111111111111f11\n    body_sha256: ${LEGACY}\n`;
			return Effect.gen(function* () {
				const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-renders-")));
				try {
					const plain = `---\n${renders(legacyRenders)}---${BODY}`;
					const digest = yield* Derivation.bodyDigest(plain);
					const text = `---\n${renders(legacyRenders)}generated:\n  by: human:ada\n  at: ${OLD_AT}\nx-okfit-integrity:\n  generated:\n    body: ${digest}\n---${BODY}`;
					yield* Effect.promise(() => writeFile(join(root, "page.md"), text));
					const first = yield* run(root);
					assert.deepStrictEqual(first.migrated, ["page"]);
					assert.deepStrictEqual(first.written, []);
					const out = yield* readPage(root);
					assert.notInclude(out, "body_sha256");
					assert.include(out, "  - path: a.md\n    body: abcdef0123456789\n");
					assert.include(out, "  - path: b.md\n    body: 1111111111111f11\n");
					assert.include(out, `  at: ${OLD_AT}\n`);
					const second = yield* run(root);
					assert.deepStrictEqual(second.migrated, []);
					assert.deepStrictEqual(second.unchanged, ["page"]);
					assert.strictEqual(yield* readPage(root), out);
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}).pipe(Effect.provide(TestPlatform));
		},
	);

	it.effect("skips a flow-style integrity with integrity-unsupported and leaves the file untouched", () =>
		withFile(
			`generated:\n  by: human:ada\n  at: ${OLD_AT}\nx-okfit-integrity: { generated: { body: 0000000000000000 } }\n`,
			BODY,
			(root) =>
				Effect.gen(function* () {
					const before = yield* readPage(root);
					const result = yield* run(root);
					assert.deepStrictEqual(result.skipped, [{ id: "page", reason: "integrity-unsupported" }]);
					assert.deepStrictEqual(result.written, []);
					assert.strictEqual(yield* readPage(root), before);
				}),
		),
	);
});

describe("syncGenerated: never stamps generated.at after a verification of the same content (R30)", () => {
	const G0 = "2026-01-01T00:00:00Z";
	const V = "2026-09-16T12:00:00Z";
	const T1 = DateTime.makeUnsafe(V);
	const T2 = DateTime.makeUnsafe("2026-09-16T12:00:42Z");
	const T2_TEXT = "2026-09-16T12:00:42Z";
	const LATE = "2026-09-16T12:05:00Z";
	const committedAt = (at: DateTime.Utc): BodyProvenance => ({
		_tag: "committed",
		at,
		sha: "0123456789abcdef0123456789abcdef01234567",
		committedAt: at,
		authorName: "Author",
		authorEmail: "author@example.com",
		creating: false,
	});

	interface Spec {
		readonly body?: string;
		/** The body the binding was computed over (defaults to `body`): differs when the body was edited after the verify. */
		readonly verifiedBody?: string;
		readonly binding?: { readonly by: string; readonly at: string };
		readonly verified?: ReadonlyArray<{ readonly by: string; readonly at: string }>;
		/** An extra frontmatter `note` scalar. */
		readonly note?: string;
		/** The `note` the binding was computed over (defaults to `note`). */
		readonly verifiedNote?: string;
	}

	const textOf = (name: string, spec: Spec, content: string): string => {
		const verified =
			spec.verified === undefined
				? ""
				: `verified:\n${spec.verified.map((e) => `  - by: ${e.by}\n    at: ${e.at}\n`).join("")}`;
		const binding =
			spec.binding === undefined
				? ""
				: `x-okfit-integrity:\n  verified:\n    by: ${spec.binding.by}\n    at: ${spec.binding.at}\n    content: ${content}\n`;
		return `---\ntype: Module\ntitle: ${name}\ngenerated:\n  by: human:ada\n  at: ${G0}\n${spec.note === undefined ? "" : `note: ${JSON.stringify(spec.note)}\n`}${verified}${binding}---\n\n${spec.body ?? "Body."}\n`;
	};

	/** A concept whose binding covers `verifiedBody` (the body the human saw). */
	const build = (name: string, spec: Spec) =>
		Effect.gen(function* () {
			const seenBody = spec.verifiedBody ?? spec.body;
			const seen: Spec = seenBody === undefined ? spec : { ...spec, body: seenBody };
			const seenNote = spec.verifiedNote ?? spec.note;
			const raw = { type: "Module", title: name, ...(seenNote === undefined ? {} : { note: seenNote }) };
			const content = yield* Derivation.contentDigest(raw, textOf(name, seen, "0".repeat(16)));
			return textOf(name, spec, content);
		}).pipe(Effect.provide(NodeCrypto.layerDigest));

	const run = (files: Record<string, string>, commit: DateTime.Utc) =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			const provenance = new Map([...bundle.concepts.keys()].map((id) => [id, committedAt(commit)] as const));
			const result = yield* syncGenerated(bundle, {
				provenance,
				renames: RENAMES,
				dryRun: false,
			});
			const fs = yield* FileSystem.FileSystem;
			const stamped: Record<string, string | undefined> = {};
			const texts: Record<string, string> = {};
			for (const name of Object.keys(files)) {
				const text = yield* fs.readFileString(`${ROOT}/${name}.md`);
				texts[name] = text;
				stamped[name] = /generated:\n {2}by: human:ada\n {2}at: (\S+)\n/.exec(text)?.[1];
			}
			return { result, stamped, texts };
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					seedPlatform(Object.fromEntries(Object.entries(files).map(([name, text]) => [`${ROOT}/${name}.md`, text]))),
					NodeCrypto.layerDigest,
				),
			),
		);

	const human = { by: "human:ada", at: V };

	it.effect("stamps the binding instant, not the commit instant, when the binding covers the current content", () =>
		Effect.gen(function* () {
			const files = {
				bound: yield* build("bound", { verified: [human], binding: human }),
				"edited-after": yield* build("edited-after", {
					verified: [human],
					binding: human,
					body: "New body.",
					verifiedBody: "Old body.",
				}),
				machine: yield* build("machine", { verified: [{ by: "process:ci", at: V }] }),
				unbound: yield* build("unbound", { verified: [human] }),
				superseded: yield* build("superseded", {
					verified: [{ by: "human:ada", at: "2026-09-16T11:00:00Z" }, human],
					binding: { by: "human:ada", at: "2026-09-16T11:00:00Z" },
				}),
				later: yield* build("later", {
					verified: [{ by: "human:ada", at: LATE }],
					binding: { by: "human:ada", at: LATE },
				}),
				"frontmatter-edited": yield* build("frontmatter-edited", {
					verified: [human],
					binding: human,
					note: "edited after the verify",
					verifiedNote: "fine",
				}),
				hashable: yield* build("hashable", { verified: [human], binding: human, note: "fine" }),
				unhashable: yield* build("unhashable", {
					verified: [human],
					binding: human,
					note: "\ud800",
					verifiedNote: "fine",
				}),
			};
			const { result, stamped } = yield* run(files, T2);
			assert.deepStrictEqual(result.written.toSorted(), Object.keys(files).toSorted());
			assert.strictEqual(stamped.bound, V); // the binding covers the current content: min(T2, T1) = T1
			assert.strictEqual(stamped["edited-after"], T2_TEXT); // body changed after the verify
			assert.strictEqual(stamped.machine, T2_TEXT); // a process: event, no binding
			assert.strictEqual(stamped.unbound, T2_TEXT); // human entry, no binding
			assert.strictEqual(stamped.superseded, T2_TEXT); // binding is not on the latest human entry
			assert.strictEqual(stamped.later, T2_TEXT); // binding later than the commit: min keeps the commit instant
			assert.strictEqual(stamped["frontmatter-edited"], T2_TEXT); // only hashable frontmatter changed after the verify
			assert.strictEqual(stamped.hashable, V); // control: an extra scalar hashes and is clamped
			assert.strictEqual(stamped.unhashable, T2_TEXT); // cannot be hashed: no clamp, no failure
			const loaded = yield* Effect.provide(
				Bundle.load({ root: ROOT }),
				seedPlatform({ [`${ROOT}/unhashable.md`]: files.unhashable }),
			);
			const concept = loaded.concepts.get(ConceptId.make("unhashable"));
			if (concept === undefined) return assert.fail("unhashable did not load");
			const digest = yield* Effect.result(
				Derivation.contentDigest(concept.frontmatter.raw, concept.document.source),
			).pipe(Effect.provide(NodeCrypto.layerDigest));
			assert.isTrue(Result.isFailure(digest)); // the precondition: it really is unhashable
		}),
	);

	it.effect("the allow-list does not gate the clamp: a binding by human:bob, outside [actors].humans, is clamped", () =>
		Effect.gen(function* () {
			const files = {
				"not-allowed": yield* build("not-allowed", {
					verified: [{ by: "human:bob", at: V }],
					binding: { by: "human:bob", at: V },
				}),
			};
			const { stamped } = yield* run(files, T2);
			assert.strictEqual(stamped["not-allowed"], V);
			// Trust.evaluate still reports the actor as not allowed
			const concept = (yield* Effect.provide(
				Bundle.load({ root: ROOT }),
				seedPlatform({ [`${ROOT}/not-allowed.md`]: files["not-allowed"] }),
			)).concepts.get(ConceptId.make("not-allowed"));
			if (concept === undefined) return assert.fail("not-allowed did not load");
			const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
				actors: { humans: ["human:ada" as ActorPattern] },
				extensions: {},
			});
			const signal = yield* Trust.signal(concept, config, T2).pipe(Effect.provide(NodeCrypto.layerDigest));
			assert.strictEqual(signal.drift?.reason, "actor-not-allowed");
		}),
	);

	it.effect("a second sync after a clamp rewrites nothing and generated.at stays binding.at", () =>
		Effect.gen(function* () {
			const text = yield* build("bound", { verified: [human], binding: human });
			yield* Effect.gen(function* () {
				const sync = Effect.gen(function* () {
					const bundle = yield* Bundle.load({ root: ROOT });
					const provenance = new Map([...bundle.concepts.keys()].map((id) => [id, committedAt(T2)] as const));
					return yield* syncGenerated(bundle, { provenance, renames: RENAMES, dryRun: false });
				});
				const fs = yield* FileSystem.FileSystem;
				const first = yield* sync;
				const afterFirst = yield* fs.readFileString(`${ROOT}/bound.md`);
				const second = yield* sync;
				assert.deepStrictEqual(first.written, ["bound"]); // positive control: the first run wrote
				assert.deepStrictEqual(second.written, []);
				assert.deepStrictEqual(second.unchanged, ["bound"]);
				assert.strictEqual(yield* fs.readFileString(`${ROOT}/bound.md`), afterFirst);
				assert.include(afterFirst, `at: ${V}\n`);
				assert.notInclude(afterFirst, T2_TEXT);
			}).pipe(Effect.provide(Layer.mergeAll(seedPlatform({ [`${ROOT}/bound.md`]: text }), NodeCrypto.layerDigest)));
		}),
	);

	/** The same concept with its existing `generated.at` moved to `at`. */
	const withGeneratedAt = (text: string, at: string) => text.replace(`at: ${G0}`, `at: ${at}`);

	it.effect("never moves generated.at backwards: a revert to verified content stamps the commit instant", () =>
		Effect.gen(function* () {
			// Verified at V (09-16); edited and stamped 10-01; reverted to the verified body and committed 11-01.
			const REV = "2026-11-01T00:00:00Z";
			const MID = "2026-10-01T00:00:00Z";
			const reverted = withGeneratedAt(yield* build("reverted", { verified: [human], binding: human }), MID);
			const boundary = withGeneratedAt(yield* build("boundary", { verified: [human], binding: human }), V);
			const files = { reverted, boundary };
			const { stamped, texts } = yield* run(files, DateTime.makeUnsafe(REV));
			assert.strictEqual(stamped.reverted, REV); // binding V is earlier than the existing stamp MID: not clamped
			assert.strictEqual(stamped.boundary, V); // control: binding.at equal to the existing stamp IS clamped
			// the tier after the revert: the verification is older than the stamp, so it does not count
			const tierOf = (name: string) =>
				Effect.gen(function* () {
					const loaded = yield* Bundle.load({ root: ROOT });
					const concept = loaded.concepts.get(ConceptId.make(name));
					if (concept === undefined) return assert.fail(`${name} did not load`);
					return Derive.trustTier(concept.frontmatter);
				}).pipe(Effect.provide(seedPlatform({ [`${ROOT}/${name}.md`]: texts[name] ?? "" })));
			assert.strictEqual(yield* tierOf("reverted"), "unverified");
			assert.strictEqual(yield* tierOf("boundary"), "human-reviewed"); // control
		}),
	);

	it.effect("clamps a concept with no generated block when a binding covers the current content", () =>
		Effect.gen(function* () {
			const text = (yield* build("fresh", { verified: [human], binding: human })).replace(
				`generated:\n  by: human:ada\n  at: ${G0}\n`,
				"",
			);
			const bundleText = { fresh: text };
			const out = yield* Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root: ROOT });
				const provenance = new Map([...bundle.concepts.keys()].map((id) => [id, committedAt(T2)] as const));
				yield* syncGenerated(bundle, { provenance, renames: RENAMES, dryRun: false, agent: "human:ada" as Actor });
				const fs = yield* FileSystem.FileSystem;
				return yield* fs.readFileString(`${ROOT}/fresh.md`);
			}).pipe(
				Effect.provide(
					Layer.mergeAll(seedPlatform({ [`${ROOT}/fresh.md`]: bundleText.fresh }), NodeCrypto.layerDigest),
				),
			);
			assert.notInclude(text, "generated:"); // precondition: no block before
			assert.include(out, `at: ${V}\n`);
			assert.notInclude(out, T2_TEXT);
		}),
	);

	it.effect("never touches an unchanged concept whose generated.at is after its binding", () =>
		Effect.gen(function* () {
			const base = yield* build("same", { verified: [human], binding: human });
			const digest = yield* Derivation.bodyDigest(base).pipe(Effect.provide(NodeCrypto.layerDigest));
			const text = base
				.replace(`at: ${G0}`, `at: ${T2_TEXT}`)
				.replace(
					"x-okfit-integrity:\n  verified:",
					`x-okfit-integrity:\n  generated:\n    body: ${digest}\n  verified:`,
				);
			const files = { same: text };
			const { result, stamped } = yield* run(files, T1);
			assert.deepStrictEqual(result.unchanged, ["same"]);
			assert.deepStrictEqual(result.written, []);
			assert.strictEqual(stamped.same, T2_TEXT);
		}),
	);
});

describe("syncGenerated: the x-okfit-integrity migration (#478)", () => {
	const DERIVED_AT = DateTime.makeUnsafe("2026-06-01T08:00:00Z");
	const committed: BodyProvenance = {
		_tag: "committed",
		at: DERIVED_AT,
		sha: "0123456789abcdef0123456789abcdef01234567",
		committedAt: DERIVED_AT,
		authorName: "Author",
		authorEmail: "author@example.com",
		creating: false,
	};
	const BODY = "\n# Page\n\nBody text.\n";
	const OLD_AT = "2020-01-01T00:00:00Z";
	const VERIFIED_SLOT = "  verified:\n    by: human:ada\n    at: 2026-02-02T02:02:02Z\n    content: bbbbbbbbbbbbbbbb\n";

	const head = (frontmatter: string) => `---\ntype: Module\n${frontmatter}---${BODY}`;
	const digestOf = (frontmatter: string) => Derivation.bodyDigest(head(frontmatter)).pipe(Effect.provide(TestPlatform));
	const generatedHead = `generated:\n  by: human:ada\n  at: ${OLD_AT}\n`;

	const withPage = <A, E, R>(text: string, use: (root: string) => Effect.Effect<A, E, R>) =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-x-okfit-")));
			return yield* Effect.gen(function* () {
				yield* Effect.promise(() => writeFile(join(root, "page.md"), text));
				return yield* use(root);
			}).pipe(Effect.ensuring(Effect.promise(() => rm(root, { recursive: true, force: true }))));
		}).pipe(Effect.provide(TestPlatform));

	const run = (root: string, withProvenance = true, provenanceOf: GeneratedProvenance = committed) =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root });
			const provenance = withProvenance
				? new Map([...bundle.concepts.keys()].map((id) => [id, provenanceOf] as const))
				: new Map();
			return yield* syncGenerated(bundle, { provenance, renames: RENAMES, dryRun: false });
		});
	const page = (root: string) => Effect.promise(() => readFile(join(root, "page.md"), "utf8"));

	it.effect("migrate-only: a verified, current legacy block moves its key and nothing else (empty provenance)", () =>
		Effect.gen(function* () {
			const digest = yield* digestOf(generatedHead);
			const legacy = head(`${generatedHead}integrity:\n  generated:\n    body: ${digest}\n${VERIFIED_SLOT}`);
			yield* withPage(legacy, (root) =>
				Effect.gen(function* () {
					const result = yield* run(root, false);
					assert.deepStrictEqual(result.written, []);
					assert.deepStrictEqual(result.migrated, ["page"]);
					assert.deepStrictEqual(result.unchanged, []);
					assert.strictEqual(yield* page(root), legacy.replace("\nintegrity:", "\nx-okfit-integrity:"));
					const again = yield* run(root, false);
					assert.deepStrictEqual(again.migrated, []);
					assert.deepStrictEqual(again.unchanged, ["page"]);
				}),
			);
		}),
	);

	it.effect("chained: drifted body, legacy body_sha256 and a legacy block migrate in one write", () =>
		Effect.gen(function* () {
			const legacy = head(
				`generated:\n  by: human:ada\n  at: ${OLD_AT}\n  body_sha256: ${"0".repeat(64)}\nintegrity:\n  generated:\n    body: aaaaaaaaaaaaaaaa\n${VERIFIED_SLOT}`,
			);
			yield* withPage(legacy, (root) =>
				Effect.gen(function* () {
					const result = yield* run(root);
					assert.deepStrictEqual(result.written, ["page"]);
					assert.deepStrictEqual(result.migrated, ["page"]);
					const out = yield* page(root);
					const digest = yield* digestOf(`generated:\n  by: human:ada\n  at: ${OLD_AT}\n`);
					assert.notInclude(out, "body_sha256");
					assert.notInclude(out, "\nintegrity:");
					assert.include(out, "  at: 2026-06-01T08:00:00Z\n");
					assert.include(out, `x-okfit-integrity:\n  generated:\n    body: ${digest}\n${VERIFIED_SLOT}`);
					assert.strictEqual((yield* run(root, false)).migrated.length, 0);
				}),
			);
		}),
	);

	it.effect("an unmigrated, unedited concept keeps generated.at (the sync trap)", () =>
		Effect.gen(function* () {
			const digest = yield* digestOf(generatedHead);
			const legacy = head(`${generatedHead}integrity:\n  generated:\n    body: ${digest}\n`);
			yield* withPage(legacy, (root) =>
				Effect.gen(function* () {
					const result = yield* run(root);
					assert.deepStrictEqual(result.written, []);
					assert.include(yield* page(root), `  at: ${OLD_AT}\n`);
				}),
			);
		}),
	);

	for (const [name, block] of [
		["integrity: ~", "integrity: ~\n"],
		["a bare integrity:", "integrity:\n"],
	] as const) {
		it.effect(`${name} becomes exactly one well-formed x-okfit-integrity block`, () =>
			withPage(head(`${generatedHead}${block}`), (root) =>
				Effect.gen(function* () {
					const result = yield* run(root);
					assert.deepStrictEqual(result.migrated, ["page"]);
					const out = yield* page(root);
					const digest = yield* digestOf(generatedHead);
					assert.strictEqual(out.split("x-okfit-integrity:").length, 2);
					assert.notInclude(out, "\nintegrity:");
					assert.include(out, `x-okfit-integrity:\n  generated:\n    body: ${digest}\n`);
					const bundle = yield* Bundle.load({ root });
					assert.strictEqual([...bundle.concepts.values()][0]?.frontmatter.integrity?.generated?.body, digest);
				}),
			),
		);
	}

	it.effect("both spellings: skipped legacy-key-conflict, file byte-identical", () => {
		const text = head(
			`${generatedHead}integrity:\n  generated:\n    body: 0000000000000000\nx-okfit-integrity:\n  generated:\n    body: 1111111111111111\n`,
		);
		return withPage(text, (root) =>
			Effect.gen(function* () {
				const result = yield* run(root);
				assert.deepStrictEqual(result.skipped, [{ id: "page", reason: "legacy-key-conflict" }]);
				assert.deepStrictEqual(result.migrated, []);
				assert.strictEqual(yield* page(root), text);
			}),
		);
	});

	for (const [name, block] of [
		["a flow-mapping legacy block", "integrity: { generated: { body: 0000000000000000 } }\n"],
		["a legacy block that merges another mapping in", "integrity:\n  <<: { generated: { body: 0000000000000000 } }\n"],
	] as const) {
		it.effect(`${name}: skipped legacy-key-unsupported, file byte-identical (verify refuses it too)`, () => {
			const text = head(`${generatedHead}${block}`);
			return withPage(text, (root) =>
				Effect.gen(function* () {
					const result = yield* run(root);
					assert.deepStrictEqual(result.skipped, [{ id: "page", reason: "legacy-key-unsupported" }]);
					assert.strictEqual(yield* page(root), text);
				}),
			);
		});
	}

	it.effect("a legacy block plus a legacy Publication renders digest migrate in one write", () =>
		Effect.gen(function* () {
			const LEGACY = "abcdef0123456789".repeat(4);
			const renders = `resource: page.md\nsurface: s\nrenders:\n  - path: a.md\n    body_sha256: ${LEGACY}\n`;
			const front = (tail: string) => `---\ntype: Publication\n${renders}${tail}---${BODY}`;
			const digest = yield* Derivation.bodyDigest(front("")).pipe(Effect.provide(TestPlatform));
			const text = front(
				`generated:\n  by: human:ada\n  at: ${OLD_AT}\nintegrity:\n  generated:\n    body: ${digest}\n`,
			);
			yield* withPage(text, (root) =>
				Effect.gen(function* () {
					const result = yield* run(root, false);
					assert.deepStrictEqual(result.migrated, ["page"]);
					const out = yield* page(root);
					assert.include(out, "x-okfit-integrity:");
					assert.notInclude(out, "body_sha256");
					assert.include(out, "    body: abcdef0123456789\n");
				}),
			);
		}),
	);

	it.effect("I-2: an in-flight legacy verification clamps generated.at to binding.at, not the commit instant", () =>
		Effect.gen(function* () {
			const BOUND_AT = "2026-03-01T00:00:00Z";
			const text = (content: string) =>
				head(
					`generated:\n  by: human:ada\n  at: ${OLD_AT}\nverified:\n  - by: human:ada\n    at: ${BOUND_AT}\nintegrity:\n  generated:\n    body: aaaaaaaaaaaaaaaa\n  verified:\n    by: human:ada\n    at: ${BOUND_AT}\n    content: ${content}\n`,
				);
			yield* withPage(text("bbbbbbbbbbbbbbbb"), (root) =>
				Effect.gen(function* () {
					const bundle = yield* Bundle.load({ root });
					const concept = [...bundle.concepts.values()][0];
					assert.isDefined(concept);
					if (concept === undefined) return;
					// What the old `verify` recorded: the content with the integrity block excluded.
					const { integrity: _legacy, ...content } = concept.frontmatter.raw;
					const digest = yield* Derivation.contentDigest(content, concept.document.source).pipe(
						Effect.provide(TestPlatform),
					);
					yield* Effect.promise(() => writeFile(join(root, "page.md"), text(digest)));
					const result = yield* run(root);
					assert.deepStrictEqual(result.written, ["page"]);
					const out = yield* page(root);
					assert.include(out, `  at: ${OLD_AT}`.replace(OLD_AT, BOUND_AT) + "\n");
					assert.notInclude(out, "2026-06-01T08:00:00Z");
				}),
			);
		}),
	);

	it.effect("I-1: a dirty legacy concept gets a rename-only write and keeps its dirty skip", () =>
		Effect.gen(function* () {
			const legacy = head(
				`generated:\n  by: human:ada\n  at: ${OLD_AT}\nverified:\n  - by: human:ada\n    at: 2026-02-02T02:02:02Z\nintegrity:\n  generated:\n    body: aaaaaaaaaaaaaaaa\n${VERIFIED_SLOT}`,
			);
			yield* withPage(legacy, (root) =>
				Effect.gen(function* () {
					const result = yield* run(root, true, { _tag: "uncommitted", reason: "dirty" });
					assert.deepStrictEqual(result.migrated, ["page"]);
					assert.deepStrictEqual(result.written, []);
					assert.deepStrictEqual(result.skipped, [{ id: "page", reason: "dirty" }]);
					assert.strictEqual(yield* page(root), legacy.replace("\nintegrity:", "\nx-okfit-integrity:"));
					const again = yield* run(root, true, { _tag: "uncommitted", reason: "dirty" });
					assert.deepStrictEqual(again.migrated, []);
					assert.deepStrictEqual(again.skipped, [{ id: "page", reason: "dirty" }]);
				}),
			);
		}),
	);

	it.effect("I-1: a verified legacy concept with no generated block is renamed and skipped generated-missing", () =>
		Effect.gen(function* () {
			const legacy = head(`integrity:\n${VERIFIED_SLOT}`);
			yield* withPage(legacy, (root) =>
				Effect.gen(function* () {
					const result = yield* run(root);
					assert.deepStrictEqual(result.migrated, ["page"]);
					assert.deepStrictEqual(result.skipped, [{ id: "page", reason: "generated-missing" }]);
					assert.strictEqual(yield* page(root), legacy.replace("\nintegrity:", "\nx-okfit-integrity:"));
					const again = yield* run(root);
					assert.deepStrictEqual(again.migrated, []);
					assert.deepStrictEqual(again.skipped, [{ id: "page", reason: "generated-missing" }]);
				}),
			);
		}),
	);

	it.effect("I-1: a conflict still writes nothing, even when the body is dirty", () =>
		Effect.gen(function* () {
			const text = head(
				`${generatedHead}integrity:\n  generated:\n    body: 0000000000000000\nx-okfit-integrity:\n  generated:\n    body: 1111111111111111\n`,
			);
			yield* withPage(text, (root) =>
				Effect.gen(function* () {
					const result = yield* run(root, true, { _tag: "uncommitted", reason: "dirty" });
					assert.deepStrictEqual(result.skipped, [{ id: "page", reason: "legacy-key-conflict" }]);
					assert.strictEqual(yield* page(root), text);
				}),
			);
		}),
	);
});
