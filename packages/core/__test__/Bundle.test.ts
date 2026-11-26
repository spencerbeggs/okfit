import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { DateTime, Effect, Option, Result } from "effect";
import type { BundleLoadOptions, LoadedBundle } from "../src/Bundle.js";
import { Bundle, BundleDepthExceededError, BundleReadError, BundleRootNotFoundError } from "../src/Bundle.js";
import type { ConceptId } from "../src/ConceptId.js";
import type { Diagnostic } from "../src/Diagnostic.js";
import { OkfitConfig } from "../src/OkfitConfig.js";
import { OkfVersion } from "../src/OkfVersion.js";
import { Validate } from "../src/Validate.js";
import { MOUNT, badBundleAtRootPlatform, faultyPlatform, platform } from "./utils/fixtures.js";
import { swapPlatform } from "./utils/swapPlatform.js";

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

describe("Bundle.inlineComputation", () => {
	const parse = (text: string) => {
		const result = Bundle.parseDocument(text);
		if (Result.isFailure(result)) throw new Error("parse failed");
		return result.success;
	};
	const trimmed = (option: Option.Option<string>) => Option.map(option, (text) => text.trim());

	it("a ## Computation with one fence: none under the legacy rule, the fence under the current rule", () => {
		const document = parse("# Revenue\n\n## Computation\n\n```sql\nSELECT 1\n```\n");
		assert.deepStrictEqual(Bundle.inlineComputation(document, "legacy"), Option.none());
		assert.deepStrictEqual(trimmed(Bundle.inlineComputation(document, "current")), Option.some("SELECT 1"));
	});
	it("a # Computation with prose and two fences: the whole section legacy, the first fence current", () => {
		const document = parse("# Computation\n\nsome prose\n\n```sql\nSELECT 1\n```\n\n```sql\nSELECT 2\n```\n");
		const legacy = Bundle.inlineComputation(document, "legacy");
		assert.isTrue(Option.isSome(legacy));
		const text = Option.getOrThrow(legacy);
		assert.include(text, "some prose");
		assert.include(text, "SELECT 2");
		assert.deepStrictEqual(trimmed(Bundle.inlineComputation(document, "current")), Option.some("SELECT 1"));
	});
	it("no Computation heading: none both ways", () => {
		const document = parse("# Revenue\n\n```sql\nSELECT 1\n```\n");
		assert.deepStrictEqual(Bundle.inlineComputation(document, "legacy"), Option.none());
		assert.deepStrictEqual(Bundle.inlineComputation(document, "current"), Option.none());
	});
});

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
	it.effect("a file that becomes a link out after the link check is refused at the read, not read (#460)", () => {
		const [layer, trap] = swapPlatform(
			{
				[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
				[`${MOUNT}/b.md`]: "---\ntype: Note\n---\n",
				"/outside/secret.md": "---\ntype: Secret\n---\n",
			},
			"lstat",
			"after",
			`${MOUNT}/a.md`,
			(fs) =>
				Effect.gen(function* () {
					yield* fs.remove(`${MOUNT}/a.md`);
					yield* fs.symlink("/outside/secret.md", `${MOUNT}/a.md`);
				}),
			// the walk lstats the file twice; the loader's own link check is the third
			3,
		);
		return Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.isTrue(trap.fired(), "the swap must have run");
			assert.deepStrictEqual([...bundle.concepts.keys()], ["b"]);
			assert.deepStrictEqual(bundle.files, ["b.md"]);
			assert.deepStrictEqual(codes(bundle.diagnostics), [["a.md", "symlink-escape", undefined]]);
			assert.deepStrictEqual(Validate.conformance(bundle), []);
		}).pipe(Effect.provide(layer));
	});
	it.effect("a file replaced under the read is a transient read failure (try again), not an escape (#460)", () => {
		const [layer, trap] = swapPlatform(
			{ [`${MOUNT}/a.md`]: "---\ntype: Note\n---\n", [`${MOUNT}/b.md`]: "---\ntype: Note\n---\n" },
			"lstat",
			"before",
			`${MOUNT}/a.md`,
			(fs) =>
				Effect.gen(function* () {
					yield* fs.remove(`${MOUNT}/a.md`);
					yield* fs.writeFileString(`${MOUNT}/a.md`, "---\ntype: Note\n---\n\nSWAPPED\n");
				}),
			// the walk lstats the file twice and the loader's link check once; the confined read's own lstat is the fourth
			4,
		);
		return Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.isTrue(trap.fired(), "the swap must have run");
			assert.deepStrictEqual([...bundle.concepts.keys()], ["b"]);
			assert.deepStrictEqual(bundle.files, ["b.md"]);
			assert.deepStrictEqual(codes(bundle.diagnostics), [["a.md", "walk-unreadable", undefined]]);
			assert.strictEqual(bundle.diagnostics[0]?.severity, "warning");
			assert.include(bundle.diagnostics[0]?.message ?? "", "changed while it was read; try again");
			assert.deepStrictEqual(Validate.conformance(bundle), []);
		}).pipe(Effect.provide(layer));
	});
	const dirLinkSeed = {
		[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
		[`${MOUNT}/sub/b.md`]: "---\ntype: Note\n---\n",
		[`${MOUNT}/external`]: MemoryFileSystem.symlink("/outside"),
		[`${MOUNT}/gone`]: MemoryFileSystem.symlink("/nowhere"),
		[`${MOUNT}/gone.md`]: MemoryFileSystem.symlink("/nowhere.md"),
		[`${MOUNT}/sub/deep-gone.md`]: MemoryFileSystem.symlink("/nowhere.md"),
		[`${MOUNT}/alias`]: MemoryFileSystem.symlink(`${MOUNT}/sub`),
		// a link inside the bundle to a directory link that leaves it: the real path is outside
		[`${MOUNT}/hop`]: MemoryFileSystem.symlink(`${MOUNT}/external`),
		[`${MOUNT}/.hidden`]: MemoryFileSystem.symlink("/outside"),
		"/outside/secret.md": "---\ntype: Secret\n---\n",
		"/outside/nested/deeper.md": "---\ntype: Secret\n---\n",
	};
	const DIR_ESCAPE =
		"symbolic link to a directory resolves outside the bundle root; nothing under it is read or part of the bundle";
	const DANGLING_FILE =
		"symbolic link could not be resolved, so it cannot be shown to stay inside the bundle root; it is not read and not part of the bundle";
	it.effect(
		"a directory link out of the bundle and a dangling link are symlink-escape; an in-bundle directory link is not (#458)",
		() =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root: MOUNT });
				assert.deepStrictEqual(codes(bundle.diagnostics), [
					["external", "symlink-escape", undefined],
					["hop", "symlink-escape", undefined],
					["gone", "symlink-escape", undefined],
					["gone.md", "symlink-escape", undefined],
					["sub/deep-gone.md", "symlink-escape", undefined],
				]);
				assert.isTrue(bundle.diagnostics.every((d) => d.severity === "warning"));
				const message = (file: string) => bundle.diagnostics.find((d) => d.file === file)?.message;
				assert.strictEqual(message("external"), DIR_ESCAPE);
				assert.strictEqual(message("hop"), DIR_ESCAPE);
				// a dangling link cannot be told from a file or a directory link: one wording for all (owner ruling Q2)
				assert.strictEqual(message("gone"), DANGLING_FILE);
				assert.strictEqual(message("gone.md"), DANGLING_FILE);
				assert.strictEqual(message("sub/deep-gone.md"), DANGLING_FILE);
				assert.isFalse(bundle.diagnostics.some((d) => d.file === "alias"));
				// nothing under an escaping directory, or the in-bundle link (Q1: unwalked and silent), is listed
				assert.deepStrictEqual(bundle.files, ["a.md", "sub/b.md"]);
				assert.deepStrictEqual([...bundle.concepts.keys()], ["a", "sub/b"]);
				assert.deepStrictEqual(Validate.conformance(bundle), []);
			}).pipe(Effect.provide(platform(dirLinkSeed))),
	);
	it.effect("a nested directory link out of the bundle is reported at its own path and never read (#458)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.deepStrictEqual(codes(bundle.diagnostics), [["sub/ext", "symlink-escape", undefined]]);
			assert.deepStrictEqual(bundle.files, ["sub/b.md"]);
			assert.deepStrictEqual([...bundle.concepts.keys()], ["sub/b"]);
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/sub/b.md`]: "---\ntype: Note\n---\n",
					[`${MOUNT}/sub/ext`]: MemoryFileSystem.symlink("/outside"),
					"/outside/secret.md": "---\ntype: Secret\n---\n",
				}),
			),
		),
	);
	it.effect("a link whose resolution fails for any reason is reported: a self loop and a mutual loop (#458, Q7)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.deepStrictEqual(codes(bundle.diagnostics), [
				["loop", "symlink-escape", undefined],
				["loopa", "symlink-escape", undefined],
				["loopb", "symlink-escape", undefined],
			]);
			assert.isTrue(bundle.diagnostics.every((d) => d.message === DANGLING_FILE));
			assert.deepStrictEqual(bundle.files, ["a.md"]);
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
					[`${MOUNT}/loop`]: MemoryFileSystem.symlink(`${MOUNT}/loop`),
					[`${MOUNT}/loopa`]: MemoryFileSystem.symlink(`${MOUNT}/loopb`),
					[`${MOUNT}/loopb`]: MemoryFileSystem.symlink(`${MOUNT}/loopa`),
				}),
			),
		),
	);
	it.effect("a pruned name is fully silent: links inside a real node_modules are not checked (#458, Q8)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.deepStrictEqual(bundle.diagnostics, []);
			assert.deepStrictEqual(bundle.files, ["a.md"]);
			// control: with node_modules no longer pruned the same links are reported, so the silence above is the prune
			const open = yield* Bundle.load({ root: MOUNT, prune: [".git"] });
			assert.deepStrictEqual(
				codes(open.diagnostics)
					.map(([file]) => file)
					.sort(),
				["node_modules/gone", "node_modules/out"],
			);
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
					[`${MOUNT}/node_modules/gone`]: MemoryFileSystem.symlink("/nowhere"),
					[`${MOUNT}/node_modules/out`]: MemoryFileSystem.symlink("/outside"),
					"/outside/x.md": "",
				}),
			),
		),
	);
	it.effect("a custom prune list silences its own names, and only those (#458, Q8)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT, prune: ["vendor"] });
			assert.deepStrictEqual(codes(bundle.diagnostics), [["node_modules", "symlink-escape", undefined]]);
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
					[`${MOUNT}/vendor`]: MemoryFileSystem.symlink("/outside"),
					[`${MOUNT}/node_modules`]: MemoryFileSystem.symlink("/outside"),
					"/outside/x.md": "",
				}),
			),
		),
	);
	it.effect("a dangling or escaping link named node_modules is silent by default (#458, Q8)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.deepStrictEqual(bundle.diagnostics, []);
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
					[`${MOUNT}/node_modules`]: MemoryFileSystem.symlink("/outside"),
					[`${MOUNT}/pkgs/node_modules`]: MemoryFileSystem.symlink("/nowhere"),
					"/outside/x.md": "",
				}),
			),
		),
	);
	it.effect(
		"prune names directories: a file link named node_modules that leaves the bundle is still reported (#458)",
		() =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root: MOUNT });
				assert.deepStrictEqual(codes(bundle.diagnostics), [["node_modules", "symlink-escape", undefined]]);
			}).pipe(
				Effect.provide(
					platform({
						[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
						[`${MOUNT}/node_modules`]: MemoryFileSystem.symlink("/outside/file.txt"),
						"/outside/file.txt": "",
					}),
				),
			),
	);
	it.effect("a dangling hidden link is silent by default and reported with includeHidden (#458)", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* Bundle.load({ root: MOUNT })).diagnostics, []);
			const shown = yield* Bundle.load({ root: MOUNT, includeHidden: true });
			assert.deepStrictEqual(codes(shown.diagnostics), [[".gone", "symlink-escape", undefined]]);
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
					[`${MOUNT}/.gone`]: MemoryFileSystem.symlink("/nowhere"),
				}),
			),
		),
	);
	it.effect("includeHidden also checks a hidden directory link (#458)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT, includeHidden: true });
			assert.include(
				bundle.diagnostics.map((d) => d.file),
				".hidden",
			);
			assert.isFalse(bundle.files.some((f) => f.startsWith(".hidden/")));
		}).pipe(Effect.provide(platform(dirLinkSeed))),
	);
	it.effect("a hidden directory link is not examined by default (#458)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.isFalse(bundle.diagnostics.some((d) => d.file === ".hidden"));
		}).pipe(Effect.provide(platform(dirLinkSeed))),
	);
	it.effect("a link to the bundle root itself is in-bundle: silent, never walked (#458)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.deepStrictEqual(bundle.diagnostics, []);
			assert.deepStrictEqual(bundle.files, ["a.md"]);
		}).pipe(
			Effect.provide(
				platform({ [`${MOUNT}/a.md`]: "---\ntype: Note\n---\n", [`${MOUNT}/self`]: MemoryFileSystem.symlink(MOUNT) }),
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
	// OKF 0.3 10.3 says "the first fenced code block in the section". Where the text does not settle a case,
	// the most literal reading is taken: a fenced code block (CommonMark: a code node opened by a fence, in any
	// container) counts; an indented code block, an HTML block or comment, and prose do not; source order decides
	// "first"; a deeper sub-heading does not end the section (sectionByHeading keeps its subsections).
	const NESTED: Record<string, string> = {
		listed: "# Computation\n\n- step one\n\n  ```sql\n  SELECT 4\n  ```\n",
		quoted: "# Computation\n\n> ```sql\n> SELECT 5\n> ```\n",
		deep: "# Computation\n\n> - step\n>\n>   ```sql\n>   SELECT 6\n>   ```\n",
		listBody: "# Computation\n\n- step\n\n  ```sql\n  SELECT a\n    FROM t\n      WHERE x\n  ```\n",
		quoteBody: "# Computation\n\n> ```sql\n> SELECT a\n>   FROM t\n>     WHERE x\n> ```\n",
		nestedFirst: "# Computation\n\n- step\n\n  ```sql\n  SELECT 4\n  ```\n\n```sql\nSELECT 1\n```\n",
		rootFirst: "# Computation\n\n```sql\nSELECT 1\n```\n\n- step\n\n  ```sql\n  SELECT 4\n  ```\n",
		indentedNested: "# Computation\n\n- step\n\n      SELECT 9\n\n  ```sql\n  SELECT 4\n  ```\n",
		indentedOnly: "# Computation\n\n- step\n\n      SELECT 9\n",
		subheading: "# Computation\n\nprose\n\n## Query\n\n- step\n\n  ```sql\n  SELECT 4\n  ```\n",
		tilde: "# Computation\n\n- step\n\n  ~~~sql\n  SELECT 4\n  ~~~\n",
		attrs: "# Computation\n\n- step\n\n  ```sql {a=1} title=x\n  SELECT 4\n  ```\n",
		empty: "# Computation\n\n- step\n\n  ```\n  ```\n",
		html: "# Computation\n\n<div>\n\n```sql\nSELECT 7\n```\n\n</div>\n",
		htmlOnly: "# Computation\n\n<!--\n```sql\nSELECT 7\n```\n-->\n",
		htmlThenFence: "# Computation\n\n<!--\n```sql\nSELECT 7\n```\n-->\n\n- step\n\n  ```sql\n  SELECT 4\n  ```\n",
		afterSection: "# Computation\n\nnone here\n\n# Next\n\n- step\n\n  ```sql\n  SELECT 3\n  ```\n",
	};
	const nestedFiles = (version: string) => ({
		[`${MOUNT}/index.md`]: `---\nokf_version: "${version}"\n---\n\n# Index\n`,
		...Object.fromEntries(
			Object.entries(NESTED).map(([name, text]) => [
				`${MOUNT}/${name}.md`,
				`---\ntype: Attested Computation\nruntime: bigquery\n---\n\n${text}`,
			]),
		),
	});
	it.effect("0.3: a fence nested in a list item or block quote of the Computation section is found (R17)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT }).pipe(
				Effect.provide(
					platform({
						...computations('okf_version: "0.3"'),
						[`${MOUNT}/listed.md`]: `---\ntype: Attested Computation\nruntime: bigquery\n---\n\n${NESTED.listed}`,
						[`${MOUNT}/quoted.md`]: `---\ntype: Attested Computation\nruntime: bigquery\n---\n\n${NESTED.quoted}`,
					}),
				),
			);
			assert.deepStrictEqual(body(bundle, "listed"), Option.some("SELECT 4"));
			assert.deepStrictEqual(body(bundle, "quoted"), Option.some("SELECT 5"));
			assert.deepStrictEqual(body(bundle, "h2"), Option.some("SELECT 1")); // control: phase 1's root-level case
			assert.isTrue(Option.isNone(body(bundle, "after"))); // control: a fence after the section is not taken
		}),
	);
	it.effect("0.3: nested fences, their text, and the cases the spec text leaves open (R17)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT }).pipe(Effect.provide(platform(nestedFiles("0.3"))));
			const raw = (name: string) => Option.map(bundle.concepts.get(id(name))?.computationBody ?? Option.none(), String);
			// two levels deep: a list inside a block quote
			assert.deepStrictEqual(body(bundle, "deep"), Option.some("SELECT 6"));
			// the body is the code as written: container indentation and `> ` removed, inner indentation kept
			assert.deepStrictEqual(raw("listBody"), Option.some("SELECT a\n  FROM t\n    WHERE x\n"));
			assert.deepStrictEqual(raw("quoteBody"), Option.some("SELECT a\n  FROM t\n    WHERE x\n"));
			// source order decides "first": the nested fence precedes the root one, and the reverse (control)
			assert.deepStrictEqual(body(bundle, "nestedFirst"), Option.some("SELECT 4"));
			assert.deepStrictEqual(body(bundle, "rootFirst"), Option.some("SELECT 1"));
			// an indented block (not fenced) before a real fence is skipped; alone it is no computation (control)
			assert.deepStrictEqual(body(bundle, "indentedNested"), Option.some("SELECT 4"));
			assert.isTrue(Option.isNone(body(bundle, "indentedOnly")));
			// a deeper sub-heading does not end the section (phase 1's reading, kept)
			assert.deepStrictEqual(body(bundle, "subheading"), Option.some("SELECT 4"));
			// `~~~`, an info string with attributes, and an empty fence
			assert.deepStrictEqual(body(bundle, "tilde"), Option.some("SELECT 4"));
			assert.deepStrictEqual(body(bundle, "attrs"), Option.some("SELECT 4"));
			assert.deepStrictEqual(body(bundle, "empty"), Option.some(""));
			// a fence inside an HTML block or comment is not a fenced code block; a real fence after it is found
			assert.isTrue(Option.isNone(body(bundle, "htmlOnly")));
			assert.deepStrictEqual(body(bundle, "html"), Option.some("SELECT 7")); // control: the HTML block ends at the blank line
			assert.deepStrictEqual(body(bundle, "htmlThenFence"), Option.some("SELECT 4"));
			// a fence after the section ends is not taken
			assert.isTrue(Option.isNone(body(bundle, "afterSection")));
		}),
	);
	it.effect("0.2 and undeclared: the same nested cases read exactly as before (the depth-1 section body)", () =>
		Effect.gen(function* () {
			for (const files of [nestedFiles("0.2"), (({ [`${MOUNT}/index.md`]: _, ...rest }) => rest)(nestedFiles("0.2"))]) {
				const bundle = yield* Bundle.load({ root: MOUNT }).pipe(Effect.provide(platform(files)));
				const legacy = (name: string) => body(bundle, name);
				assert.deepStrictEqual(legacy("listed"), Option.some("- step one\n\n  ```sql\n  SELECT 4\n  ```"));
				assert.deepStrictEqual(legacy("quoted"), Option.some("> ```sql\n> SELECT 5\n> ```"));
				assert.deepStrictEqual(legacy("deep"), Option.some("> - step\n>\n>   ```sql\n>   SELECT 6\n>   ```"));
				assert.deepStrictEqual(
					legacy("rootFirst"),
					Option.some("```sql\nSELECT 1\n```\n\n- step\n\n  ```sql\n  SELECT 4\n  ```"),
				);
				assert.deepStrictEqual(legacy("indentedOnly"), Option.some("- step\n\n      SELECT 9"));
				assert.deepStrictEqual(legacy("afterSection"), Option.some("none here"));
			}
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
