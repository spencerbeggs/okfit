import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Effect } from "effect";
import { FrontmatterEdits, UnsupportedFrontmatterError } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "edits");
const read = (name: string): string => readFileSync(join(dir, name), "utf8");
const expected = (name: string): string => readFileSync(join(dir, "expected", name), "utf8");

const apply = (name: string) =>
	Effect.map(FrontmatterEdits.status(read(name), "deprecated"), (edits) => MarkdownEdit.applyAll(read(name), edits));

describe("FrontmatterEdits.status", () => {
	for (const name of [
		"status-plain.md",
		"status-quoted.md",
		"status-absent-with-title.md",
		"status-absent-no-title.md",
		"status-crlf.md",
		"status-bom.md",
		"status-last-key.md",
		"status-single-quoted.md",
		"status-absent-anchor-last.md",
		"status-absent-title-folded.md",
		"status-absent-title-literal.md",
	]) {
		it.effect(`rewrites ${name} to the expected file`, () =>
			Effect.map(apply(name), (out) => assert.strictEqual(out, expected(name))),
		);
	}

	it.effect("returns exactly one edit whose offsets fall inside the frontmatter block", () =>
		Effect.map(FrontmatterEdits.status(read("status-plain.md"), "draft"), (edits) => {
			assert.strictEqual(edits.length, 1);
			const source = read("status-plain.md");
			const close = source.indexOf("\n---", 4);
			assert.ok(edits[0]!.offset > 4 && edits[0]!.offset + edits[0]!.length <= close);
		}),
	);

	it.effect("fails typed on a flow-mapping frontmatter", () =>
		Effect.map(Effect.flip(FrontmatterEdits.status(read("status-flow-mapping.md"), "draft")), (error) => {
			assert.ok(error instanceof UnsupportedFrontmatterError);
			assert.strictEqual(error.key, "status");
			assert.strictEqual(error.shape, "flow-mapping");
		}),
	);

	it.effect("setting the status a concept already has is still one replace edit (idempotent text)", () =>
		Effect.map(FrontmatterEdits.status(read("status-plain.md"), "stable"), (edits) => {
			assert.strictEqual(MarkdownEdit.applyAll(read("status-plain.md"), edits), read("status-plain.md"));
		}),
	);
});

describe("FrontmatterEdits.status unsupported shapes", () => {
	it.effect("fails typed with no-anchor-key when neither title nor type anchors an insert", () =>
		Effect.map(Effect.flip(FrontmatterEdits.status(read("status-no-anchor-key.md"), "deprecated")), (error) => {
			assert.ok(error instanceof UnsupportedFrontmatterError);
			assert.strictEqual(error.key, "status");
			assert.strictEqual(error.shape, "no-anchor-key");
		}),
	);

	it.effect("fails typed with status-not-scalar when status is a mapping", () =>
		Effect.map(Effect.flip(FrontmatterEdits.status(read("status-not-scalar.md"), "deprecated")), (error) => {
			assert.ok(error instanceof UnsupportedFrontmatterError);
			assert.strictEqual(error.key, "status");
			assert.strictEqual(error.shape, "status-not-scalar");
		}),
	);

	it.effect("fails typed with status-block-scalar when status is a block-literal scalar", () =>
		Effect.map(Effect.flip(FrontmatterEdits.status(read("status-block-scalar.md"), "deprecated")), (error) => {
			assert.ok(error instanceof UnsupportedFrontmatterError);
			assert.strictEqual(error.key, "status");
			assert.strictEqual(error.shape, "status-block-scalar");
		}),
	);

	it.effect("positive control: a supported fixture in the same describe still rewrites cleanly", () =>
		Effect.map(apply("status-plain.md"), (out) => assert.strictEqual(out, expected("status-plain.md"))),
	);
});

describe("FrontmatterEdits.verified", () => {
	it.effect("matches okfit verify's splice on the absent case", () =>
		Effect.map(
			FrontmatterEdits.verified(read("status-plain.md"), { by: "human:spencer", at: "2026-09-23T12:00:00Z" }),
			(edits) => {
				const out = MarkdownEdit.applyAll(read("status-plain.md"), edits);
				assert.ok(out.includes("verified:\n  - by: human:spencer\n    at: 2026-09-23T12:00:00Z\n"));
				assert.ok(out.endsWith("# Alpha\n"));
			},
		),
	);
});
