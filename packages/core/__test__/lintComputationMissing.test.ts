import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path } from "effect";
import { Bundle } from "../src/Bundle.js";
import { OkfitConfig } from "../src/OkfitConfig.js";
import { Validate } from "../src/Validate.js";

const SECTION_MESSAGE =
	"This Attested Computation has no computation: its Computation section holds no fenced code block (OKF 0.3 §10.3), so it is not attestable; put the computation in one fenced block, or set computation to a file";
const NO_SECTION_MESSAGE =
	"This Attested Computation has no computation: it has no Computation section and no computation key (OKF 0.3 §10.3), so it is not attestable";

const V03 = '---\nokf_version: "0.3"\n---\n\n# Index\n';
const V02 = "# Index\n";

const load = (sources: Record<string, string>) => {
	const mount = "/repo/computation-missing";
	const seed: Record<string, string> = {};
	for (const [relative, content] of Object.entries(sources)) seed[`${mount}/${relative}`] = content;
	return Effect.provide(Bundle.load({ root: mount }), Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer));
};

const concept = (body: string, extra = "runtime: bigquery\n", type = "Attested Computation") =>
	`---\ntype: ${type}\n${extra}---\n\n${body}`;

const missing = (bundle: Parameters<typeof Validate.lint>[0], config: OkfitConfig = OkfitConfig.DEFAULTS) =>
	Validate.lint(bundle, config).filter((d) => d.code === "computation-missing");

const textAt = (source: string, range: { readonly offset: number; readonly length: number } | undefined) =>
	range === undefined ? undefined : source.slice(range.offset, range.offset + range.length);

describe("computation-missing", () => {
	it.effect("a 0.3 bundle: a prose-only Computation section is computation-missing at its heading", () =>
		Effect.gen(function* () {
			const source = concept("# Revenue\n\n# Computation\n\nSELECT 1 as prose\n");
			const bundle = yield* load({ "index.md": V03, "a.md": source });
			const found = missing(bundle);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0]?.code, "computation-missing");
			assert.strictEqual(found[0]?.severity, "warning");
			assert.strictEqual(found[0]?.message, SECTION_MESSAGE);
			assert.strictEqual(textAt(source, found[0]?.range), "# Computation");
			const control = yield* load({ "index.md": V03, "a.md": concept("# Computation\n\n```sql\nSELECT 1\n```\n") });
			assert.deepStrictEqual(missing(control), [], "control: a fenced block is silent");
		}),
	);

	it.effect("a 0.3 bundle: a fenced block at any heading level is silent", () =>
		Effect.gen(function* () {
			const bundle = yield* load({
				"index.md": V03,
				"a.md": concept("# Revenue\n\n## Computation\n\n```sql\nSELECT 1\n```\n"),
			});
			assert.deepStrictEqual(missing(bundle), []);
			const control = yield* load({ "index.md": V03, "b.md": concept("# Revenue\n\n## Computation\n\nprose\n") });
			assert.strictEqual(missing(control).length, 1, "control: the same shape without a fence fires");
		}),
	);

	it.effect("a 0.3 bundle: a computation key is silent with no section", () =>
		Effect.gen(function* () {
			const bundle = yield* load({
				"index.md": V03,
				"a.md": concept("# Revenue\n", "runtime: bigquery\ncomputation: q.sql\n"),
			});
			assert.deepStrictEqual(missing(bundle), []);
			const control = yield* load({ "index.md": V03, "b.md": concept("# Revenue\n") });
			assert.strictEqual(missing(control).length, 1, "control: without the key it fires");
		}),
	);

	it.effect("a 0.3 bundle: no section and no key is computation-missing at the frontmatter", () =>
		Effect.gen(function* () {
			const source = concept("# Revenue\n");
			const bundle = yield* load({ "index.md": V03, "a.md": source });
			const found = missing(bundle);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0]?.message, NO_SECTION_MESSAGE);
			assert.isTrue(textAt(source, found[0]?.range)?.startsWith("---"));
		}),
	);

	it.effect("a CRLF prose-only section fires like its LF twin", () =>
		Effect.gen(function* () {
			const lf = concept("# Revenue\n\n# Computation\n\nprose\n");
			const crlf = lf.replace(/\n/g, "\r\n");
			const a = missing(yield* load({ "index.md": V03, "a.md": lf }));
			const b = missing(yield* load({ "index.md": V03, "a.md": crlf }));
			assert.strictEqual(a.length, 1);
			assert.deepStrictEqual(
				b.map((d) => [d.code, d.message]),
				a.map((d) => [d.code, d.message]),
			);
		}),
	);

	it.effect("a 0.2 bundle: a prose-only depth-1 section is the legacy computation, so silent", () =>
		Effect.gen(function* () {
			const bundle = yield* load({ "index.md": V02, "a.md": concept("# Computation\n\nSELECT 1\n") });
			assert.deepStrictEqual(missing(bundle), []);
			const control = yield* load({ "index.md": V02, "b.md": concept("# Computation\n\n") });
			assert.strictEqual(missing(control).length, 1, "control: an empty legacy section fires");
		}),
	);

	it.effect("a 0.2 bundle: no section at all fires", () =>
		Effect.gen(function* () {
			const bundle = yield* load({ "index.md": V02, "a.md": concept("# Revenue\n") });
			const found = missing(bundle);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0]?.message, NO_SECTION_MESSAGE);
		}),
	);

	it.effect("fires without runtime, beside computation-runtime-missing", () =>
		Effect.gen(function* () {
			const bundle = yield* load({ "index.md": V03, "a.md": concept("# Revenue\n", "") });
			const codes = [...bundle.diagnostics, ...Validate.lint(bundle, OkfitConfig.DEFAULTS)].map((d) => d.code);
			assert.isTrue(codes.includes("computation-runtime-missing"));
			assert.isTrue(codes.includes("computation-missing"));
		}),
	);

	it.effect('[lint] computation_missing = "off" silences it', () =>
		Effect.gen(function* () {
			const bundle = yield* load({ "index.md": V03, "a.md": concept("# Revenue\n") });
			const off = OkfitConfig.merge(OkfitConfig.DEFAULTS, { lint: { computation_missing: "off" }, extensions: {} });
			assert.deepStrictEqual(missing(bundle, off), []);
			assert.strictEqual(missing(bundle).length, 1, "control: the default fires");
		}),
	);

	it.effect("a concept of another type with a prose Computation section is silent", () =>
		Effect.gen(function* () {
			const bundle = yield* load({
				"index.md": V03,
				"a.md": concept("# Computation\n\nprose\n", "", "Note"),
			});
			assert.deepStrictEqual(missing(bundle), []);
			const control = yield* load({ "index.md": V03, "b.md": concept("# Computation\n\nprose\n") });
			assert.strictEqual(missing(control).length, 1, "control: the same body on an Attested Computation fires");
		}),
	);
});
