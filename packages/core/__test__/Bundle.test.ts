import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { DateTime, Effect, Option } from "effect";
import type { BundleLoadOptions, LoadedBundle } from "../src/Bundle.js";
import { Bundle, BundleDepthExceededError, BundleReadError, BundleRootNotFoundError } from "../src/Bundle.js";
import type { ConceptId } from "../src/ConceptId.js";
import type { Diagnostic } from "../src/Diagnostic.js";
import { OkfitConfig } from "../src/OkfitConfig.js";
import { OkfVersion } from "../src/OkfVersion.js";
import { Validate } from "../src/Validate.js";
import { MOUNT, badBundleAtRootPlatform, faultyPlatform, platform } from "./utils/fixtures.js";

const load = (name: string, options: Omit<BundleLoadOptions, "root"> = {}) =>
	Bundle.load({ root: MOUNT, ...options }).pipe(Effect.provide(badBundleAtRootPlatform(name)));
const codes = (diagnostics: ReadonlyArray<Diagnostic>) => diagnostics.map((d) => [d.file, d.code, d.range?.line]);
const id = (value: string) => value as ConceptId;

const computations = (frontmatter?: string) => ({
	...(frontmatter === undefined
		? {}
		: { [`${MOUNT}/index.md`]: `---\n${frontmatter}\n---\n\n# Attested Computation\n\n* [H2](h2.md)\n` }),
	[`${MOUNT}/h2.md`]:
		"---\ntype: Attested Computation\nruntime: bigquery\n---\n\n# Revenue\n\n## Computation\n\nprose\n\n    indented\n\n```sql\nSELECT 1\n```\n\n### Notes\n\n```sql\nSELECT 2\n```\n",
	[`${MOUNT}/prose.md`]: "---\ntype: Attested Computation\nruntime: bigquery\n---\n\n# Computation\n\nSELECT 1\n",
	[`${MOUNT}/after.md`]:
		"---\ntype: Attested Computation\nruntime: bigquery\n---\n\n## Computation\n\nnone here\n\n## Next\n\n```sql\nSELECT 3\n```\n",
});
const body = (bundle: LoadedBundle, conceptId: string) =>
	Option.map(bundle.concepts.get(id(conceptId))?.computationBody ?? Option.none(), (text) => text.trim());

describe("Bundle.load", () => {
	it.effect("fails typed when the root is missing or a file (D-9)", () =>
		Effect.gen(function* () {
			const missing = yield* Effect.flip(Bundle.load({ root: "/nowhere" }));
			assert.instanceOf(missing, BundleRootNotFoundError);
			assert.strictEqual(missing.root, "/nowhere");
			assert.instanceOf(yield* Effect.flip(Bundle.load({ root: `${MOUNT}/visible.md` })), BundleRootNotFoundError);
		}).pipe(Effect.provide(badBundleAtRootPlatform("c-hidden-directory"))),
	);
	it.effect("unreadable root and unreadable file are BundleReadError; unreadable subdirectory is a warning", () =>
		Effect.gen(function* () {
			const root = yield* Effect.flip(
				Bundle.load({ root: MOUNT }).pipe(Effect.provide(faultyPlatform({ [`${MOUNT}/a.md`]: "" }, new Set([MOUNT])))),
			);
			assert.instanceOf(root, BundleReadError);
			assert.strictEqual(root.path, "");
			const file = yield* Effect.flip(
				Bundle.load({ root: MOUNT }).pipe(
					Effect.provide(faultyPlatform({ [`${MOUNT}/gone.md`]: "" }, new Set(), new Set([`${MOUNT}/gone.md`]))),
				),
			);
			assert.instanceOf(file, BundleReadError);
			assert.strictEqual(file.path, "gone.md");
			const bundle = yield* Bundle.load({ root: MOUNT }).pipe(
				Effect.provide(faultyPlatform({ [`${MOUNT}/locked/a.md`]: "" }, new Set([`${MOUNT}/locked`]))),
			);
			assert.deepStrictEqual(codes(bundle.diagnostics), [["locked", "walk-unreadable", undefined]]);
			assert.strictEqual(bundle.diagnostics[0]?.severity, "warning");
			// The walker now carries the cause (effected#648), so the message names it.
			assert.match(bundle.diagnostics[0]?.message ?? "", /"locked".*PermissionDenied/);
		}),
	);
	it.effect(
		"a .md with no frontmatter is skipped with a lint warning, not a conformance error (OKF 0.3 §3.2, R5)",
		() =>
			Effect.gen(function* () {
				const bundle = yield* load("c-frontmatter-missing");
				assert.deepStrictEqual(codes(bundle.diagnostics), [["no-front.md", "frontmatter-missing", undefined]]);
				assert.strictEqual(bundle.diagnostics[0]?.severity, "warning");
				assert.strictEqual(bundle.concepts.size, 0);
				assert.strictEqual(bundle.indexes.get("")?.sections[0]?.entries[0]?.target, "no-front.md");
				assert.deepStrictEqual(bundle.files, ["index.md", "no-front.md"]);
				assert.deepStrictEqual(Validate.conformance(bundle), []);
				assert.deepStrictEqual(
					Validate.lint(bundle, OkfitConfig.DEFAULTS).map((d) => [d.code, d.severity]),
					[["frontmatter-missing", "warning"]],
				);
				const off = OkfitConfig.merge(OkfitConfig.DEFAULTS, { lint: { frontmatter_missing: "off" }, extensions: {} });
				assert.deepStrictEqual(Validate.lint(bundle, off), []);
			}),
	);
	it.effect("frontmatter-unclosed points at the fence; unparseable YAML maps into file coordinates (D-14)", () =>
		Effect.gen(function* () {
			const unclosed = yield* load("c-frontmatter-unclosed");
			assert.deepStrictEqual(codes(unclosed.diagnostics), [["unclosed.md", "frontmatter-unclosed", 0]]);
			assert.strictEqual(unclosed.diagnostics[0]?.range?.length, 3);
			const dup = yield* load("c-duplicate-key");
			assert.deepStrictEqual(codes(dup.diagnostics), [["dup.md", "frontmatter-unparseable", 3]]);
			assert.strictEqual(unclosed.concepts.size + dup.concepts.size, 0);
		}),
	);
	it.effect("a typeless .md is skipped with a lint warning, not a conformance error (OKF 0.3 §3.2, R5)", () =>
		Effect.gen(function* () {
			const bundle = yield* load("c-type-missing");
			assert.deepStrictEqual(
				bundle.diagnostics.map((d) => d.code),
				["type-missing"],
			);
			assert.strictEqual(bundle.diagnostics[0]?.severity, "warning");
			assert.strictEqual(bundle.concepts.size, 0);
			assert.deepStrictEqual(Validate.conformance(bundle), []);
		}),
	);
	it.effect("a frontmatter block that is a list is not a mapping: frontmatter-unparseable, a conformance error", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT }).pipe(
				Effect.provide(platform({ [`${MOUNT}/list.md`]: "---\n- a\n- b\n---\n" })),
			);
			assert.deepStrictEqual(codes(bundle.diagnostics), [["list.md", "frontmatter-unparseable", 0]]);
			assert.strictEqual(bundle.diagnostics[0]?.severity, "error");
			assert.strictEqual(bundle.diagnostics[0]?.message, "frontmatter is not a mapping");
			assert.strictEqual(Validate.conformance(bundle).length, 1);
			assert.strictEqual(bundle.concepts.size, 0);
		}),
	);
	it.effect("a symlink that leaves the bundle is neither listed nor read; one inside is (OKF 0.3 §3.2 rule 5)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.deepStrictEqual(bundle.files, ["a.md", "in.md"]);
			assert.deepStrictEqual([...bundle.concepts.keys()], ["a", "in"]);
			assert.deepStrictEqual(codes(bundle.diagnostics), [
				["logo.png", "symlink-escape", undefined],
				["out.md", "symlink-escape", undefined],
			]);
			assert.isTrue(bundle.diagnostics.every((d) => d.severity === "warning"));
			assert.deepStrictEqual(Validate.conformance(bundle), []);
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
					[`${MOUNT}/in.md`]: MemoryFileSystem.symlink(`${MOUNT}/a.md`),
					[`${MOUNT}/out.md`]: MemoryFileSystem.symlink("/outside/secret.md"),
					[`${MOUNT}/logo.png`]: MemoryFileSystem.symlink("/outside/logo.png"),
					"/outside/secret.md": "---\ntype: Secret\n---\n",
					"/outside/logo.png": "",
				}),
			),
		),
	);
	it.effect(
		"root okf_version accepted, non-root index frontmatter rejected; concept and computation body load (D-20, D-21)",
		() =>
			Effect.gen(function* () {
				const bundle = yield* load("c-index-frontmatter");
				assert.deepStrictEqual(codes(bundle.diagnostics), [["sub/index.md", "index-frontmatter", 0]]);
				assert.strictEqual(bundle.indexes.get("")?.okfVersion, "0.2");
				assert.strictEqual(bundle.indexes.get("sub")?.sections[0]?.heading, "Sub");
				const thing = bundle.concepts.get(id("sub/thing"));
				assert.strictEqual(thing?.path, "sub/thing.md");
				assert.strictEqual(thing?.frontmatter.type, "Note");
				assert.deepStrictEqual(
					Option.map(thing?.computationBody ?? Option.none(), (body) => body.trim()),
					Option.some("SELECT 1"),
				);
				assert.deepStrictEqual(bundle.directories, ["sub"]);
			}),
	);
	it.effect(
		"0.3: the computation is the first fenced block of the Computation section at any heading level; no fence is missing (OKF 0.3 §10.3)",
		() =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root: MOUNT }).pipe(
					Effect.provide(platform(computations('okf_version: "0.3"'))),
				);
				assert.deepStrictEqual(body(bundle, "h2"), Option.some("SELECT 1"));
				assert.deepStrictEqual(body(bundle, "prose"), Option.none());
				assert.deepStrictEqual(body(bundle, "after"), Option.none());
			}),
	);
	it.effect(
		"0.3: an indented block opening with a fence line is not the computation; tildes and a deeper subsection are found",
		() =>
			Effect.gen(function* () {
				const concept = (text: string, extra = "") =>
					`---\ntype: Attested Computation\nruntime: bigquery\n${extra}---\n\n${text}`;
				const bundle = yield* Bundle.load({ root: MOUNT }).pipe(
					Effect.provide(
						platform({
							[`${MOUNT}/index.md`]: '---\nokf_version: "0.3"\n---\n\n# Index\n',
							[`${MOUNT}/indented.md`]: concept(
								"## Computation\n\n    ```sql\n    SELECT 9\n    ```\n\n```sql\nSELECT 1\n```\n",
							),
							[`${MOUNT}/tilde.md`]: concept("## Computation\n\n~~~sql\nSELECT 4\n~~~\n"),
							[`${MOUNT}/deeper.md`]: concept("## Computation\n\nprose\n\n### Query\n\n```sql\nSELECT 5\n```\n"),
							[`${MOUNT}/both.md`]: concept(
								"## Computation\n\n```sql\nSELECT 6\n```\n",
								"computation: queries/q.sql\n",
							),
						}),
					),
				);
				assert.deepStrictEqual(body(bundle, "indented"), Option.some("SELECT 1"));
				assert.deepStrictEqual(body(bundle, "tilde"), Option.some("SELECT 4"));
				assert.deepStrictEqual(body(bundle, "deeper"), Option.some("SELECT 5"));
				assert.deepStrictEqual(body(bundle, "both"), Option.some("SELECT 6"));
				assert.strictEqual(bundle.concepts.get(id("both"))?.frontmatter.attested?.computation, "queries/q.sql");
			}),
	);
	it.effect("0.2 or undeclared: the depth-1 Computation section's body, as before (owner ruling 3)", () =>
		Effect.gen(function* () {
			for (const frontmatter of [undefined, 'okf_version: "0.2"']) {
				const bundle = yield* Bundle.load({ root: MOUNT }).pipe(Effect.provide(platform(computations(frontmatter))));
				assert.deepStrictEqual(body(bundle, "prose"), Option.some("SELECT 1"));
				assert.deepStrictEqual(body(bundle, "h2"), Option.none());
			}
		}),
	);
	it.effect("an unquoted root okf_version warns and still gates the legacy fallbacks (OKF 0.3 §8.1)", () =>
		Effect.gen(function* () {
			const load = (version: string) =>
				Bundle.load({ root: MOUNT }).pipe(
					Effect.provide(platform({ [`${MOUNT}/index.md`]: `---\nokf_version: ${version}\n---\n\n# Metric\n` })),
				);
			const old = yield* load("0.2");
			assert.deepStrictEqual(codes(old.diagnostics), [["index.md", "index-metadata-invalid", 1]]);
			assert.isTrue(OkfVersion.legacyFallbacks(old));
			const current = yield* load("0.3");
			assert.deepStrictEqual(codes(current.diagnostics), [["index.md", "index-metadata-invalid", 1]]);
			assert.isFalse(OkfVersion.legacyFallbacks(current));
		}),
	);
	it.effect("log-heading-invalid comes from the reserved parser; log.md is never a concept (D-12)", () =>
		Effect.gen(function* () {
			const bundle = yield* load("c-log-heading-invalid");
			assert.deepStrictEqual(codes(bundle.diagnostics), [["log.md", "log-heading-invalid", 6]]);
			assert.deepStrictEqual([...bundle.concepts.keys()], ["note"]);
			assert.strictEqual(bundle.logs.get("")?.groups.length, 1);
		}),
	);
	it.effect("index entries before any section heading are index-malformed; the heading's own entry still parses", () =>
		Effect.gen(function* () {
			const bundle = yield* load("c-index-entries-before-heading");
			assert.deepStrictEqual(codes(bundle.diagnostics), [["index.md", "index-malformed", 0]]);
			assert.strictEqual(bundle.diagnostics[0]?.message, "index entries appear before any section heading");
			assert.strictEqual(bundle.indexes.get("")?.sections[0]?.heading, "Widgets");
			assert.strictEqual(bundle.indexes.get("")?.sections[0]?.entries.length, 1);
			assert.strictEqual(bundle.indexes.get("")?.sections[0]?.entries[0]?.target, "widget.md");
		}),
	);
	it.effect("a bundle deeper than maxDepth fails with BundleDepthExceededError (W-1)", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				Bundle.load({ root: MOUNT, maxDepth: 1 }).pipe(Effect.provide(platform({ [`${MOUNT}/a/b/c.md`]: "" }))),
			);
			assert.instanceOf(error, BundleDepthExceededError);
			assert.strictEqual(error.path, "a");
			assert.strictEqual(error.limit, 1);
		}),
	);
	it.effect("hidden entries are excluded unless includeHidden (D-11)", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual([...(yield* load("c-hidden-directory")).concepts.keys()], ["visible"]);
			assert.deepStrictEqual(
				[...(yield* load("c-hidden-directory", { includeHidden: true })).concepts.keys()],
				[".drafts/secret", ".hidden", "visible"],
			);
		}),
	);
	it.effect(
		"reads a date-only stale_after and generated.at; an offset-less date-time is value-malformed (OKF 0.3 §5)",
		() =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root: MOUNT }).pipe(
					Effect.provide(
						platform({
							[`${MOUNT}/day.md`]:
								"---\ntype: Note\nstale_after: 2026-12-31\ngenerated:\n  by: human:a\n  at: 2026-06-30\n---\n\n# Day\n",
							[`${MOUNT}/offsetless.md`]: "---\ntype: Note\nstale_after: 2026-12-31T08:00:00\n---\n\n# Offsetless\n",
						}),
					),
				);
				const day = bundle.concepts.get(id("day"));
				assert.strictEqual(
					day?.frontmatter.stale_after === undefined ? undefined : DateTime.formatIso(day.frontmatter.stale_after),
					"2026-12-31T00:00:00.000Z",
				);
				assert.strictEqual(
					day?.frontmatter.generated?.at === undefined ? undefined : DateTime.formatIso(day.frontmatter.generated.at),
					"2026-06-30T00:00:00.000Z",
				);
				assert.deepStrictEqual(
					bundle.diagnostics.filter((d) => d.file === "day.md"),
					[],
				);
				const control = bundle.diagnostics.filter((d) => d.file === "offsetless.md");
				assert.deepStrictEqual(
					control.map((d) => [d.code, d.severity, d.range?.line, d.range?.character]),
					[["value-malformed", "warning", 2, 13]],
				);
			}),
	);
});
