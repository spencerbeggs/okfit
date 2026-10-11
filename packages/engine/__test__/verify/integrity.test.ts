import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { FrontmatterSource, MarkdownEdit } from "@effected/markdown";
import { YamlDocument } from "@effected/yaml";
import { Concept } from "@okfit/core";
import { Effect, Schema } from "effect";
import type { IntegrityFields } from "../../src/verify/integrity.js";
import {
	formatDigest,
	locateIntegrity,
	locateLegacyBodySha256,
	removeLine,
	renderIntegrity,
	spliceIntegrity,
	spliceIntegrityGenerated,
	spliceIntegrityVerified,
} from "../../src/verify/integrity.js";
import { documentNewline, stripBom } from "../../src/verify/locate.js";
import { countLines, decodeFrontmatter } from "../utils/frontmatter.js";

const DIR = join(import.meta.dirname, "..", "fixtures", "verify", "integrity");
const read = (name: string): string => readFileSync(join(DIR, name), "utf8");
const expected = (name: string): string => readFileSync(join(DIR, "expected", name), "utf8");

const GENERATED = { body: "47fef58df84c6eb2" } as const;
const VERIFIED = { by: "human:spencer", at: "2026-10-10T18:00:00Z", content: "9a1c3f07b2e8d415" } as const;

const apply = (name: string, fields: IntegrityFields) =>
	Effect.gen(function* () {
		const { text, bom } = stripBom(read(name));
		const located = yield* locateIntegrity(text);
		if (located._tag === "unsupported") throw new Error(`unsupported ${located.shape}`);
		return bom + MarkdownEdit.applyAll(text, [spliceIntegrity(located, fields, documentNewline(text))]);
	});

describe("integrity splice", () => {
	it.effect("inserts at the end of the frontmatter when absent (LF)", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* apply("absent.md", { generated: GENERATED }), expected("absent.md"));
		}),
	);
	it.effect("inserts with CRLF and a BOM", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* apply("absent-crlf-bom.md", { generated: GENERATED }), expected("absent-crlf-bom.md"));
		}),
	);
	it.effect("replaces a block holding only generated", () =>
		Effect.gen(function* () {
			const { text } = stripBom(read("replace-generated-only.md"));
			const located = yield* locateIntegrity(text);
			assert.strictEqual(located._tag, "replace");
			if (located._tag === "replace") {
				assert.deepStrictEqual(located.current?.generated?.body, "0000000000000000");
				assert.isUndefined(located.current?.verified);
			}
			assert.strictEqual(
				yield* apply("replace-generated-only.md", { generated: GENERATED, verified: VERIFIED }),
				expected("replace-generated-only.md"),
			);
		}),
	);
	it.effect("replaces a block holding both slots", () =>
		Effect.gen(function* () {
			const { text } = stripBom(read("replace-both.md"));
			const located = yield* locateIntegrity(text);
			if (located._tag === "replace") assert.strictEqual(located.current?.verified?.by, "human:old");
			else assert.fail("expected replace");
			assert.strictEqual(
				yield* apply("replace-both.md", { generated: GENERATED, verified: VERIFIED }),
				expected("replace-both.md"),
			);
		}),
	);
	it.effect("replaces a malformed block, reporting current as undefined", () =>
		Effect.gen(function* () {
			const { text } = stripBom(read("replace-malformed.md"));
			const located = yield* locateIntegrity(text);
			if (located._tag === "replace") assert.isUndefined(located.current);
			else assert.fail("expected replace");
			assert.strictEqual(
				yield* apply("replace-malformed.md", { generated: GENERATED }),
				expected("replace-malformed.md"),
			);
		}),
	);
	it.effect("deletes the block when no slot remains", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* apply("delete.md", {}), expected("delete.md"));
		}),
	);
	it.effect("reports an alias as unsupported", () =>
		Effect.gen(function* () {
			const located = yield* locateIntegrity(read("alias.md"));
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "alias" });
		}),
	);
	it.effect("reports a flow mapping as unsupported", () =>
		Effect.gen(function* () {
			const located = yield* locateIntegrity(read("flow-mapping.md"));
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "flow-mapping" });
		}),
	);
	it("renders nothing for no slots and canonical YAML otherwise", () => {
		assert.strictEqual(renderIntegrity({}, "\n"), "");
		assert.strictEqual(
			renderIntegrity({ verified: VERIFIED }, "\r\n"),
			"integrity:\r\n  verified:\r\n    by: human:spencer\r\n    at: 2026-10-10T18:00:00Z\r\n    content: 9a1c3f07b2e8d415\r\n",
		);
	});
});

describe("legacy body_sha256", () => {
	for (const name of ["legacy-last.md", "legacy-middle.md"]) {
		it.effect(`${name}: locates the line and removeLine drops exactly it`, () =>
			Effect.gen(function* () {
				const text = read(name);
				const located = yield* locateLegacyBodySha256(text);
				if (located._tag !== "line") return assert.fail("expected line");
				assert.strictEqual(located.value, "abc");
				assert.strictEqual(text.slice(located.start, located.end), "  body_sha256: abc\n");
				assert.strictEqual(MarkdownEdit.applyAll(text, [removeLine(located)]), expected(name));
			}),
		);
	}
	it.effect("reports none when body_sha256 is absent", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* locateLegacyBodySha256(read("legacy-none.md")), { _tag: "none" });
		}),
	);
});

describe("digest quoting", () => {
	it("quotes numeric-looking digests and leaves ordinary ones plain", () => {
		assert.strictEqual(formatDigest("0000000000000000"), "'0000000000000000'");
		assert.strictEqual(formatDigest("1234e56789012345"), "'1234e56789012345'");
		assert.strictEqual(formatDigest("47fef58df84c6eb2"), "47fef58df84c6eb2");
		assert.strictEqual(formatDigest("e234567890123456"), "e234567890123456");
	});
	it.effect("an all-digit digest round-trips through locateIntegrity and the Concept decode", () =>
		Effect.gen(function* () {
			const fields = {
				generated: { body: "1234567890123456" },
				verified: { ...VERIFIED, content: "1234e56789012345" },
			};
			const out = yield* apply("absent.md", fields);
			assert.include(out, "body: '1234567890123456'");
			assert.include(out, "content: '1234e56789012345'");
			const located = yield* locateIntegrity(out);
			if (located._tag !== "replace") return assert.fail("expected replace");
			assert.strictEqual(located.current?.generated?.body, "1234567890123456");
			assert.strictEqual(located.current?.verified?.content, "1234e56789012345");
			const block = FrontmatterSource.split(out).frontmatter;
			const doc = yield* YamlDocument.parse(block?.value ?? "");
			const raw = doc.contents?.toValue() as Record<string, unknown>;
			const concept = yield* Schema.decodeUnknownEffect(Concept)({ ...raw, extensions: {}, raw });
			assert.isDefined(concept.integrity);
		}),
	);
});

describe("slot splices follow the parsed block", () => {
	const HEAD = "---\ntype: Decision\ntitle: T\n";
	const TAIL = "owner: x\n---\n\n# T\n";
	const slot = (source: string, which: "generated" | "verified"): Effect.Effect<string, unknown> =>
		Effect.gen(function* () {
			const located = yield* locateIntegrity(source);
			if (located._tag === "unsupported") return `unsupported ${located.shape}`;
			const edit =
				which === "generated"
					? spliceIntegrityGenerated(located, source, GENERATED.body, "\n")
					: spliceIntegrityVerified(located, source, VERIFIED, "\n");
			return MarkdownEdit.applyAll(source, [edit]);
		});

	it.effect("a quoted verified key is replaced in place, never duplicated", () =>
		Effect.gen(function* () {
			const source = `${HEAD}integrity:\n  generated:\n    body: 0123456789abcdef\n  'verified':\n    by: human:old\n    at: 2026-01-01T00:00:00Z\n    content: abcdef0123456789\n${TAIL}`;
			const out = yield* slot(source, "verified");
			assert.strictEqual(countLines(out, /verified['"]?:/u), 1);
			const concept = yield* decodeFrontmatter(out);
			assert.strictEqual(concept.integrity?.verified?.by, "human:spencer");
			assert.strictEqual(concept.integrity?.generated?.body, "0123456789abcdef");
		}),
	);

	it.effect("a double-quoted generated key is replaced in place, never duplicated", () =>
		Effect.gen(function* () {
			const source = `${HEAD}integrity:\n  "generated":\n    body: 0123456789abcdef\n${TAIL}`;
			const out = yield* slot(source, "generated");
			assert.strictEqual(countLines(out, /generated['"]?:/u), 1);
			assert.strictEqual((yield* decodeFrontmatter(out)).integrity?.generated?.body, GENERATED.body);
		}),
	);

	it.effect("a comment on the integrity key line survives a slot rewrite, as does the other slot", () =>
		Effect.gen(function* () {
			const verified = "  verified:\n    by: human:ada\n    at: 2026-01-01T00:00:00Z\n    content: abcdef0123456789\n";
			const source = `${HEAD}integrity:  # okfit owns this\n  generated:\n    body: 0123456789abcdef\n${verified}${TAIL}`;
			const out = yield* slot(source, "generated");
			assert.strictEqual(
				out,
				`${HEAD}integrity:  # okfit owns this\n  generated:\n    body: ${GENERATED.body}\n${verified}${TAIL}`,
			);
		}),
	);

	it.effect("a block that does not decode as a whole keeps its valid slot when the other is rewritten", () =>
		Effect.gen(function* () {
			const verified = "  verified:\n    by: human:ada\n    at: 2026-01-01T00:00:00Z\n    content: abcdef0123456789\n";
			const source = `${HEAD}integrity:  # note\n  generated: nope\n${verified}${TAIL}`;
			const out = yield* slot(source, "generated");
			assert.strictEqual(
				out,
				`${HEAD}integrity:  # note\n  generated:\n    body: ${GENERATED.body}\n${verified}${TAIL}`,
			);
		}),
	);

	it.effect("a block with content the editor cannot map is unsupported, never silently rewritten", () =>
		Effect.gen(function* () {
			const source = `${HEAD}integrity:\n  ? [complex]\n  : 1\n  verified:\n    by: human:ada\n${TAIL}`;
			const located = yield* locateIntegrity(source);
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "integrity-layout" });
		}),
	);

	it.effect("exposes the bound actor even when the block does not decode", () =>
		Effect.gen(function* () {
			const source = `${HEAD}integrity:\n  generated: nope\n  verified:\n    by: human:ada\n    at: 2026-01-01T00:00:00Z\n    content: abcdef0123456789\n${TAIL}`;
			const located = yield* locateIntegrity(source);
			if (located._tag !== "replace") return assert.fail("expected replace");
			assert.isUndefined(located.current);
			assert.strictEqual(located.boundBy, "human:ada");
		}),
	);
});
