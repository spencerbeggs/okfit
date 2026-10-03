import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { Concept, ConceptId, LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Crypto, Effect, Layer, Option, Result } from "effect";
import { Derivation } from "../src/Derivation.js";
import { Publications } from "../src/Publications.js";

const FRONTMATTER_OPTIONS = MarkdownParseOptions.make({ frontmatter: true });

/** A concept at bundle-relative `path` (with `.md`), with `raw` mirroring its frontmatter. */
const conceptAt = (path: string, type: string, raw: Record<string, unknown>, source: string): LoadedConcept =>
	LoadedConcept.make({
		id: Option.getOrThrow(ConceptId.normalize(path)),
		path,
		frontmatter: Concept.make({ type, extensions: {}, raw }),
		document: Result.getOrThrow(MarkdownDocument.parseResult(source, FRONTMATTER_OPTIONS)),
		computationBody: Option.none(),
	});

const bundleOf = (...concepts: ReadonlyArray<LoadedConcept>): LoadedBundle =>
	LoadedBundle.make({
		root: "/bundle",
		files: concepts.map((c) => c.path),
		directories: [""],
		concepts: new Map(concepts.map((c) => [c.id, c])),
		indexes: new Map(),
		logs: new Map(),
		diagnostics: [],
	});

const sourceA = conceptAt(
	"interfaces/a.md",
	"Interface",
	{ type: "Interface" },
	"---\ntype: Interface\n---\n\n# A\n\nBody of A.\n",
);
const sourceB = conceptAt(
	"interfaces/b.md",
	"Interface",
	{ type: "Interface" },
	"---\ntype: Interface\n---\n\n# B\n\nBody of B.\n",
);
const surface = conceptAt("surfaces/readme.md", "Surface", { type: "Surface" }, "---\ntype: Surface\n---\n\n# S\n");

const digestOf = (c: LoadedConcept) => Derivation.bodyDigest(c.document.source).pipe(Effect.provide(NodeCrypto.layer));

/** A Publication at `publications/pr.md` whose frontmatter text matches `raw`. */
const publication = (raw: Record<string, unknown>, frontmatterYaml: string): LoadedConcept =>
	conceptAt(
		"publications/pr.md",
		"Publication",
		{ type: "Publication", resource: "../../README.md", ...raw },
		`---\ntype: Publication\nresource: ../../README.md\n${frontmatterYaml}---\n\n# PR\n`,
	);

const STALE = "0".repeat(64);

describe("Publications.resolveRef", () => {
	it("normalises .md, ./ and ../", () => {
		assert.strictEqual(
			Publications.resolveRef("publications/pr.md", "../conventions/commits.md"),
			"conventions/commits",
		);
		assert.strictEqual(Publications.resolveRef("publications/pr.md", "../conventions/commits"), "conventions/commits");
		assert.strictEqual(Publications.resolveRef("publications/pr.md", "./sub/x.md"), "publications/sub/x");
	});
	it("returns empty when escaping the bundle", () => {
		assert.strictEqual(Publications.resolveRef("publications/pr.md", "../../docs/x.md"), "");
	});
});

describe("Publications.lint", () => {
	const run = (bundle: LoadedBundle, config: OkfitConfig = OkfitConfig.DEFAULTS) =>
		Publications.lint(bundle, config).pipe(Effect.provide(NodeCrypto.layer));

	it.effect("silent when every digest matches", () =>
		Effect.gen(function* () {
			const a = yield* digestOf(sourceA);
			const pub = publication(
				{ surface: "../surfaces/readme.md", renders: [{ path: "../interfaces/a.md", body_sha256: a }] },
				`surface: ../surfaces/readme.md\nrenders:\n  - path: ../interfaces/a.md\n    body_sha256: ${a}\n`,
			);
			assert.deepStrictEqual(yield* run(bundleOf(sourceA, surface, pub)), []);
		}),
	);

	it.effect("one publication-drift naming every changed source", () =>
		Effect.gen(function* () {
			const pub = publication(
				{
					surface: "../surfaces/readme.md",
					renders: [
						{ path: "../interfaces/a.md", body_sha256: STALE },
						{ path: "../interfaces/b.md", body_sha256: STALE },
					],
				},
				`surface: ../surfaces/readme.md\nrenders:\n  - path: ../interfaces/a.md\n    body_sha256: ${STALE}\n  - path: ../interfaces/b.md\n    body_sha256: ${STALE}\n`,
			);
			const result = yield* run(bundleOf(sourceA, sourceB, surface, pub));
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]?.code, "publication-drift");
			assert.strictEqual(result[0]?.severity, "warning");
			assert.strictEqual(result[0]?.file, "publications/pr.md");
			assert.isDefined(result[0]?.range);
			assert.include(result[0]?.message, "interfaces/a (changed)");
			assert.include(result[0]?.message, "interfaces/b (changed)");
			assert.include(result[0]?.message, "okfit sync --publication publications/pr");
		}),
	);

	it.effect("reports never-stamped entries as drift, not orphan", () =>
		Effect.gen(function* () {
			const pub = publication(
				{ surface: "../surfaces/readme.md", renders: [{ path: "../interfaces/a.md" }] },
				"surface: ../surfaces/readme.md\nrenders:\n  - path: ../interfaces/a.md\n",
			);
			const result = yield* run(bundleOf(sourceA, surface, pub));
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]?.code, "publication-drift");
			assert.include(result[0]?.message, "interfaces/a (never stamped)");
		}),
	);

	it.effect("publication-orphan when surface does not resolve", () =>
		Effect.gen(function* () {
			const a = yield* digestOf(sourceA);
			const pub = publication(
				{ surface: "../surfaces/missing.md", renders: [{ path: "../interfaces/a.md", body_sha256: a }] },
				`surface: ../surfaces/missing.md\nrenders:\n  - path: ../interfaces/a.md\n    body_sha256: ${a}\n`,
			);
			const result = yield* run(bundleOf(sourceA, pub));
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]?.code, "publication-orphan");
			assert.strictEqual(result[0]?.severity, "error");
			assert.strictEqual(result[0]?.file, "publications/pr.md");
			const range = result[0]?.range;
			assert.isDefined(range);
			const offset = pub.document.source.indexOf("../surfaces/missing.md");
			assert.strictEqual(range?.offset, offset);
		}),
	);

	it.effect("publication-orphan per unresolvable renders[i].path", () =>
		Effect.gen(function* () {
			const a = yield* digestOf(sourceA);
			const pub = publication(
				{
					surface: "../surfaces/readme.md",
					renders: [
						{ path: "../interfaces/a.md", body_sha256: a },
						{ path: "../interfaces/gone.md", body_sha256: a },
						{ path: "../../escape.md", body_sha256: a },
					],
				},
				`surface: ../surfaces/readme.md\nrenders:\n  - path: ../interfaces/a.md\n    body_sha256: ${a}\n  - path: ../interfaces/gone.md\n    body_sha256: ${a}\n  - path: ../../escape.md\n    body_sha256: ${a}\n`,
			);
			const result = yield* run(bundleOf(sourceA, surface, pub));
			assert.deepStrictEqual(
				result.map((d) => d.code),
				["publication-orphan", "publication-orphan"],
			);
			assert.include(result[0]?.message, "interfaces/gone");
			assert.include(result[1]?.message, "escape");
			assert.strictEqual(result[0]?.range?.offset, pub.document.source.indexOf("../interfaces/gone.md"));
			assert.strictEqual(result[1]?.range?.offset, pub.document.source.indexOf("../../escape.md"));
		}),
	);

	it.effect("publication-orphan when renders is not a list of { path }", () =>
		Effect.gen(function* () {
			const pub = publication(
				{ surface: "../surfaces/readme.md", renders: "x" },
				"surface: ../surfaces/readme.md\nrenders: x\n",
			);
			const result = yield* run(bundleOf(surface, pub));
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]?.code, "publication-orphan");
			assert.strictEqual(result[0]?.severity, "error");
			assert.include(result[0]?.message, "renders must be a list");
			assert.isDefined(result[0]?.range);
		}),
	);

	it.effect("publication-orphan when renders is an empty list", () =>
		Effect.gen(function* () {
			const pub = publication(
				{ surface: "../surfaces/readme.md", renders: [] },
				"surface: ../surfaces/readme.md\nrenders: []\n",
			);
			const result = yield* run(bundleOf(surface, pub));
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]?.code, "publication-orphan");
			assert.include(result[0]?.message, "renders must name at least one source");
			assert.isDefined(result[0]?.range);
		}),
	);

	it.effect("publication-orphan naming the actual type when surface resolves to a non-Surface concept", () =>
		Effect.gen(function* () {
			const a = yield* digestOf(sourceA);
			const pub = publication(
				{ surface: "../interfaces/b.md", renders: [{ path: "../interfaces/a.md", body_sha256: a }] },
				`surface: ../interfaces/b.md\nrenders:\n  - path: ../interfaces/a.md\n    body_sha256: ${a}\n`,
			);
			const result = yield* run(bundleOf(sourceA, sourceB, pub));
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]?.code, "publication-orphan");
			assert.include(result[0]?.message, "Interface");
			assert.include(result[0]?.message, "Surface");
		}),
	);

	it.effect("skips the surface check when surface is absent", () =>
		Effect.gen(function* () {
			const a = yield* digestOf(sourceA);
			const pub = publication(
				{ renders: [{ path: "../interfaces/a.md", body_sha256: a }] },
				`renders:\n  - path: ../interfaces/a.md\n    body_sha256: ${a}\n`,
			);
			assert.deepStrictEqual(yield* run(bundleOf(sourceA, pub)), []);
		}),
	);

	describe("severity combinations", () => {
		// One stale source (drift) plus an unresolvable surface (orphan).
		const both = () =>
			publication(
				{ surface: "../surfaces/missing.md", renders: [{ path: "../interfaces/a.md", body_sha256: STALE }] },
				`surface: ../surfaces/missing.md\nrenders:\n  - path: ../interfaces/a.md\n    body_sha256: ${STALE}\n`,
			);
		const withLint = (lint: Partial<OkfitConfig["lint"]>): OkfitConfig => ({
			...OkfitConfig.DEFAULTS,
			lint: { ...OkfitConfig.DEFAULTS.lint, ...lint },
		});

		it.effect("default severities report both codes", () =>
			Effect.gen(function* () {
				const result = yield* run(bundleOf(sourceA, both()));
				assert.deepStrictEqual(
					result.map((d) => [d.code, d.severity]),
					[
						["publication-drift", "warning"],
						["publication-orphan", "error"],
					].sort(([a], [b]) => (a < b ? -1 : 1)),
				);
			}),
		);

		it.effect("drift off with orphan on reports only the orphan", () =>
			Effect.gen(function* () {
				const result = yield* run(bundleOf(sourceA, both()), withLint({ publication_drift: "off" }));
				assert.deepStrictEqual(
					result.map((d) => d.code),
					["publication-orphan"],
				);
			}),
		);

		it.effect("orphan off with drift on reports only the drift", () =>
			Effect.gen(function* () {
				const result = yield* run(bundleOf(sourceA, both()), withLint({ publication_orphan: "off" }));
				assert.deepStrictEqual(
					result.map((d) => d.code),
					["publication-drift"],
				);
			}),
		);

		it.effect("an override raises the severity of each code", () =>
			Effect.gen(function* () {
				const result = yield* run(
					bundleOf(sourceA, both()),
					withLint({ publication_drift: "error", publication_orphan: "warn" }),
				);
				assert.deepStrictEqual(
					result.map((d) => [d.code, d.severity]),
					[
						["publication-drift", "error"],
						["publication-orphan", "warning"],
					],
				);
			}),
		);
	});

	it.effect("returns [] for both codes when both are off", () =>
		Effect.gen(function* () {
			const pub = publication(
				{ surface: "../surfaces/missing.md", renders: [{ path: "../interfaces/a.md", body_sha256: STALE }] },
				`surface: ../surfaces/missing.md\nrenders:\n  - path: ../interfaces/a.md\n    body_sha256: ${STALE}\n`,
			);
			const config: OkfitConfig = {
				...OkfitConfig.DEFAULTS,
				lint: { ...OkfitConfig.DEFAULTS.lint, publication_drift: "off", publication_orphan: "off" },
			};
			// A Crypto that dies on any use proves no digest work happens.
			const dying = Layer.succeed(
				Crypto.Crypto,
				new Proxy({} as Crypto.Crypto, {
					get: () => {
						throw new Error("Crypto must not be used");
					},
				}),
			);
			const result = yield* Publications.lint(bundleOf(sourceA, pub), config).pipe(Effect.provide(dying));
			assert.deepStrictEqual(result, []);
		}),
	);

	it.effect("ignores concepts that are not Publications", () =>
		Effect.gen(function* () {
			const module = conceptAt(
				"modules/m.md",
				"Module",
				{ type: "Module", renders: "x", surface: "../nope.md" },
				"---\ntype: Module\nrenders: x\nsurface: ../nope.md\n---\n\n# M\n",
			);
			assert.deepStrictEqual(yield* run(bundleOf(module)), []);
		}),
	);
});
