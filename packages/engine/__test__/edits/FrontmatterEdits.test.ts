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

const CONTENT = "c0ffee0123456789";

describe("FrontmatterEdits.verified", () => {
	it.effect("matches okfit verify's splice on the absent case", () =>
		Effect.map(
			FrontmatterEdits.verified(read("status-plain.md"), { by: "human:spencer", at: "2026-09-23T12:00:00Z" }, CONTENT),
			(edits) => {
				const out = MarkdownEdit.applyAll(read("status-plain.md"), edits);
				assert.ok(out.includes("verified:\n  - by: human:spencer\n    at: 2026-09-23T12:00:00Z\n"));
				assert.ok(out.endsWith("# Alpha\n"));
			},
		),
	);

	const entry = { by: "human:spencer", at: "2026-09-23T12:00:00Z" };
	const withBlock = (lines: ReadonlyArray<string>) =>
		["---", "type: Module", ...lines, "---", "", "# B", ""].join("\n");

	it.effect("writes verified then integrity.verified, byte-exact, when both are absent", () => {
		const source = withBlock(["title: A"]);
		return Effect.map(FrontmatterEdits.verified(source, entry, CONTENT), (edits) => {
			assert.strictEqual(edits.length, 1);
			assert.strictEqual(
				MarkdownEdit.applyAll(source, edits),
				withBlock([
					"title: A",
					"verified:",
					"  - by: human:spencer",
					"    at: 2026-09-23T12:00:00Z",
					"integrity:",
					"  verified:",
					"    by: human:spencer",
					"    at: 2026-09-23T12:00:00Z",
					`    content: ${CONTENT}`,
				]),
			);
		});
	});

	it.effect("rewrites only the verified slot of an existing integrity block, keeping generated byte-identical", () => {
		const generated = ["integrity:", "  generated:", "    # keep me", "    body: 0123456789abcdef"];
		const source = withBlock(["title: A", ...generated]);
		return Effect.map(FrontmatterEdits.verified(source, entry, CONTENT), (edits) => {
			const out = MarkdownEdit.applyAll(source, edits);
			assert.ok(out.includes(`${generated.join("\n")}\n  verified:\n    by: human:spencer\n`));
			assert.strictEqual(out.split("integrity:").length, 2);
		});
	});

	it.effect("replaces a malformed integrity.verified, leaving a single binding", () => {
		const source = withBlock(["title: A", "integrity:", "  verified:", "    by: nope"]);
		return Effect.map(FrontmatterEdits.verified(source, entry, CONTENT), (edits) => {
			const out = MarkdownEdit.applyAll(source, edits);
			assert.strictEqual(out.split("verified:").length, 3);
			assert.ok(!out.includes("by: nope"));
			assert.ok(out.includes(`content: ${CONTENT}`));
		});
	});

	it.effect("fails keyed integrity on an unsupported integrity shape", () =>
		Effect.map(Effect.flip(FrontmatterEdits.verified(withBlock(["integrity: nope"]), entry, CONTENT)), (error) => {
			assert.ok(error instanceof UnsupportedFrontmatterError);
			assert.strictEqual(error.key, "integrity");
		}),
	);
});

const D1 = "a".repeat(16);
const D2 = "b".repeat(16);
const pub = (renders: string, nl = "\n"): string =>
	[
		"---",
		"type: Publication",
		"resource: page.md",
		"surface: s",
		"renders:",
		...renders.split("\n"),
		"---",
		"",
		"Body.",
		"",
	].join(nl);
const stampRenders = (source: string, digests: ReadonlyArray<string>) =>
	Effect.map(FrontmatterEdits.rendersDigests(source, digests), (edits) => MarkdownEdit.applyAll(source, edits));

describe("FrontmatterEdits.rendersDigests", () => {
	it.effect("replaces an existing digest in place", () => {
		const source = pub(`  - path: a.md\n    body: ${"0".repeat(16)}`);
		return Effect.map(stampRenders(source, [D1]), (out) =>
			assert.strictEqual(out, pub(`  - path: a.md\n    body: ${D1}`)),
		);
	});

	it.effect("inserts a missing key under the path at the key's column", () =>
		Effect.map(stampRenders(pub("  - path: a.md"), [D1]), (out) =>
			assert.strictEqual(out, pub(`  - path: a.md\n    body: ${D1}`)),
		),
	);

	it.effect("handles one stamped and one unstamped entry", () => {
		const source = pub(`  - path: a.md\n    body: ${"0".repeat(16)}\n  - path: b.md`);
		return Effect.map(stampRenders(source, [D1, D2]), (out) =>
			assert.strictEqual(out, pub(`  - path: a.md\n    body: ${D1}\n  - path: b.md\n    body: ${D2}`)),
		);
	});

	it.effect("keeps CRLF", () =>
		Effect.map(stampRenders(pub("  - path: a.md", "\r\n"), [D1]), (out) =>
			assert.strictEqual(out, pub(`  - path: a.md\n    body: ${D1}`, "\r\n")),
		),
	);

	it.effect("shifts offsets past a BOM", () => {
		const source = `﻿${pub("  - path: a.md")}`;
		return Effect.map(stampRenders(source, [D1]), (out) =>
			assert.strictEqual(out, `﻿${pub(`  - path: a.md\n    body: ${D1}`)}`),
		);
	});

	it.effect("replaces a legacy body_sha256 line with body, never leaving both keys", () => {
		const source = pub(`  - path: a.md\n    body_sha256: ${"f".repeat(64)}`);
		return Effect.map(stampRenders(source, [D1]), (out) => {
			assert.strictEqual(out, pub(`  - path: a.md\n    body: ${D1}`));
			assert.notInclude(out, "body_sha256");
		});
	});

	it.effect("replaces body and drops a legacy body_sha256 sitting beside it", () => {
		const source = pub(
			`  - path: a.md\n    body: ${"0".repeat(16)}\n    body_sha256: ${"f".repeat(64)}\n  - path: b.md`,
		);
		return Effect.map(stampRenders(source, [D1, D2]), (out) =>
			assert.strictEqual(out, pub(`  - path: a.md\n    body: ${D1}\n  - path: b.md\n    body: ${D2}`)),
		);
	});

	it.effect("single-quotes a numeric-looking digest", () =>
		Effect.map(stampRenders(pub("  - path: a.md"), ["1234567890123456"]), (out) =>
			assert.strictEqual(out, pub("  - path: a.md\n    body: '1234567890123456'")),
		),
	);

	it.effect("fails typed with dash-prefixed-key when a legacy body_sha256 leads its entry", () =>
		Effect.map(
			Effect.flip(FrontmatterEdits.rendersDigests(pub(`  - body_sha256: ${"f".repeat(64)}\n    path: a.md`), [D1])),
			(error) => {
				assert.ok(error instanceof UnsupportedFrontmatterError);
				assert.strictEqual(error.shape, "dash-prefixed-key");
			},
		),
	);

	it.effect("fails typed on flow-style renders", () =>
		Effect.map(
			Effect.flip(FrontmatterEdits.rendersDigests("---\ntype: Publication\nrenders: [{path: a.md}]\n---\n", [D1])),
			(error) => {
				assert.ok(error instanceof UnsupportedFrontmatterError);
				assert.strictEqual(error.key, "renders");
			},
		),
	);

	it.effect("replaces a quoted digest value, quotes included", () => {
		const source = pub(`  - path: a.md\n    body: "${"0".repeat(16)}"`);
		return Effect.map(stampRenders(source, [D1]), (out) =>
			assert.strictEqual(out, pub(`  - path: a.md\n    body: ${D1}`)),
		);
	});

	// MarkdownDocument.parseResult never fails on malformed frontmatter YAML (it
	// is lenient), so the "unparseable" shape is a defensive branch that real
	// input cannot reach; invalid YAML surfaces as another typed shape instead.
	it.effect("fails typed, never crashes, when the frontmatter is not valid YAML", () =>
		Effect.map(
			Effect.flip(FrontmatterEdits.rendersDigests("---\ntype: Publication\nrenders: [unclosed\n---\n\nBody.\n", [D1])),
			(error) => {
				assert.ok(error instanceof UnsupportedFrontmatterError);
				assert.strictEqual(error.key, "renders");
			},
		),
	);

	it.effect("fails typed on a document with no frontmatter", () =>
		Effect.map(Effect.flip(FrontmatterEdits.rendersDigests("no frontmatter\n", [D1])), (error) => {
			assert.ok(error instanceof UnsupportedFrontmatterError);
			assert.strictEqual(error.key, "renders");
		}),
	);
});

describe("FrontmatterEdits.verifiedWithStatus", () => {
	const entry = { by: "human:spencer", at: "2026-09-23T12:00:00Z" };
	const doc = (frontmatter: ReadonlyArray<string>, nl = "\n", bom = ""): string =>
		`${bom}${["---", ...frontmatter, "---", "", "# Body", ""].join(nl)}`;
	const run = (source: string) =>
		Effect.map(FrontmatterEdits.verifiedWithStatus(source, entry, "stable", CONTENT), (edits) =>
			MarkdownEdit.applyAll(source, edits),
		);

	it.effect("merges the same-offset case: status before verified when both are absent and title is last", () => {
		const source = doc(["type: Module", "title: Alpha"]);
		return Effect.map(run(source), (out) =>
			assert.strictEqual(
				out,
				doc([
					"type: Module",
					"title: Alpha",
					"status: stable",
					"verified:",
					"  - by: human:spencer",
					"    at: 2026-09-23T12:00:00Z",
					"integrity:",
					"  verified:",
					"    by: human:spencer",
					"    at: 2026-09-23T12:00:00Z",
					`    content: ${CONTENT}`,
				]),
			),
		);
	});

	it.effect("replaces an existing draft status and appends verified", () => {
		const source = doc(["type: Module", "status: draft", "title: Alpha"]);
		return Effect.map(run(source), (out) => {
			assert.ok(out.includes("status: stable\n"));
			assert.ok(!out.includes("draft"));
			assert.ok(out.includes("verified:\n  - by: human:spencer\n    at: 2026-09-23T12:00:00Z\n"));
		});
	});

	it.effect("makes only the verified edit when status already equals the target", () => {
		const source = doc(["type: Module", "status: stable", "title: Alpha"]);
		return Effect.map(FrontmatterEdits.verifiedWithStatus(source, entry, "stable", CONTENT), (edits) => {
			assert.strictEqual(edits.length, 1);
			assert.strictEqual(edits[0]?.length, 0);
			assert.ok(MarkdownEdit.applyAll(source, edits).includes("status: stable\n"));
		});
	});

	it.effect("treats a quoted matching status as already at the target", () => {
		const source = doc(["type: Module", 'status: "stable"', "title: Alpha"]);
		return Effect.map(FrontmatterEdits.verifiedWithStatus(source, entry, "stable", CONTENT), (edits) =>
			assert.strictEqual(edits.length, 1),
		);
	});

	it.effect("uses CRLF newlines throughout", () => {
		const source = doc(["type: Module", "title: Alpha"], "\r\n");
		return Effect.map(run(source), (out) => {
			assert.ok(out.includes("status: stable\r\nverified:\r\n"));
			assert.ok(!/[^\r]\n/u.test(out));
		});
	});

	it.effect("shifts offsets by the BOM length", () => {
		const source = doc(["type: Module", "status: draft", "title: Alpha"], "\n", "﻿");
		return Effect.map(run(source), (out) => {
			assert.ok(out.startsWith("﻿---\n"));
			assert.ok(out.includes("status: stable\n"));
			assert.ok(out.includes("verified:"));
		});
	});

	it.effect("fails keyed verified when verified is an unsupported shape", () =>
		Effect.map(
			Effect.flip(
				FrontmatterEdits.verifiedWithStatus(doc(["type: Module", "verified: nope"]), entry, "stable", CONTENT),
			),
			(error) => {
				assert.ok(error instanceof UnsupportedFrontmatterError);
				assert.strictEqual(error.key, "verified");
			},
		),
	);

	it.effect("fails keyed status when status is an unsupported shape", () =>
		Effect.map(
			Effect.flip(FrontmatterEdits.verifiedWithStatus(read("status-block-scalar.md"), entry, "stable", CONTENT)),
			(error) => {
				assert.ok(error instanceof UnsupportedFrontmatterError);
				assert.strictEqual(error.key, "status");
				assert.strictEqual(error.shape, "status-block-scalar");
			},
		),
	);
});
