import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import {
	Bundle,
	Concept,
	ConceptId,
	Derive,
	IndexDocument,
	LoadedBundle,
	LoadedConcept,
	OKF_SPEC_VERSION,
} from "@okfit/core";
import { Effect, FileSystem, Layer, Option, Path, Result } from "effect";
import { syncIndex } from "../../src/sync/index.js";
import type { PendingWrite } from "../../src/sync/write.js";
import { UNDECLARED_PROJECT, V02_PROJECT, V03_PROJECT } from "../fixtures/bundles.js";
import { ROOT, denyAccess, mountProject, projectPlatform, seedPlatform } from "../utils/bundle.js";
import { withRealBundle } from "../utils/realBundle.js";
import { swapOn } from "../utils/swapPlatform.js";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const emptyDocument = Result.getOrThrow(MarkdownDocument.parseResult(""));

const conceptAt = (relativePath: string, title: string): LoadedConcept =>
	LoadedConcept.make({
		id: Option.getOrThrow(ConceptId.normalize(relativePath)),
		path: relativePath,
		frontmatter: Concept.make({ type: "Decision", title, extensions: {}, raw: {} }),
		document: emptyDocument,
		computationBody: Option.none(),
	});

describe("syncIndex", () => {
	it.effect("writes a directory's index.md only when the rendered bytes differ from disk", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-index-")));
			try {
				const concept = conceptAt("widgets/thing.md", "Thing");
				const bundle = LoadedBundle.make({
					root,
					files: [concept.path],
					directories: ["widgets"],
					concepts: new Map([[concept.id, concept]]),
					indexes: new Map(),
					logs: new Map(),
					diagnostics: [],
				});
				const expectedRootIndex = Derive.renderIndex("", [], { subdirectories: ["widgets"] });
				const expectedWidgetsIndex = Derive.synthesizeIndex(bundle, "widgets");

				// `bundle.directories` only ever names a directory that already holds
				// a concept file (Bundle.load's own invariant) -- this in-memory
				// fixture has no real "widgets/thing.md" on disk, so the directory
				// is created here to match that invariant for the write itself.
				yield* Effect.promise(() => mkdir(join(root, "widgets"), { recursive: true }));

				// The root's index.md is absent -- counts as different (design §4).
				const first = yield* syncIndex(bundle, false);
				assert.deepStrictEqual([...first.written].sort(), ["index.md", "widgets/index.md"]);
				assert.deepStrictEqual(first.unchanged, []);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "index.md"), "utf8")), expectedRootIndex);
				assert.strictEqual(
					yield* Effect.promise(() => readFile(join(root, "widgets", "index.md"), "utf8")),
					expectedWidgetsIndex,
				);

				// Second run: both files already match -> unchanged, nothing written.
				const second = yield* syncIndex(bundle, false);
				assert.deepStrictEqual(second.written, []);
				assert.deepStrictEqual([...second.unchanged].sort(), ["index.md", "widgets/index.md"]);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);

	it.effect(
		"lists a directory holding only index.md (no concepts) in the root's Subdirectories, matching synthesizeIndex's own union (S-29)",
		() =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-index-indexonly-")));
				try {
					// "empty" holds only an index.md -- Bundle.load never records such a
					// directory in `bundle.directories` (no concept lives there), but it
					// is still a key of `bundle.indexes`.
					const bundle = LoadedBundle.make({
						root,
						files: ["empty/index.md"],
						directories: [],
						concepts: new Map(),
						indexes: new Map([["empty", IndexDocument.make({ path: "empty/index.md", dir: "empty", sections: [] })]]),
						logs: new Map(),
						diagnostics: [],
					});
					const expectedRootIndex = Derive.renderIndex("", [], { subdirectories: ["empty"] });

					const result = yield* syncIndex(bundle, false);
					assert.deepStrictEqual(result.written, ["index.md"]);
					const written = yield* Effect.promise(() => readFile(join(root, "index.md"), "utf8"));
					assert.strictEqual(written, expectedRootIndex);
					assert.ok(written.includes("[empty](empty/index.md)"));
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}).pipe(Effect.provide(platform)),
	);

	it.effect("writes an index.md for an ancestor directory that holds no concept itself, only a nested directory", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-index-nested-")));
			try {
				const concept = conceptAt("topics/deep/thing.md", "Thing");
				const bundle = LoadedBundle.make({
					root,
					files: [concept.path],
					directories: ["topics/deep"],
					concepts: new Map([[concept.id, concept]]),
					indexes: new Map(),
					logs: new Map(),
					diagnostics: [],
				});
				yield* Effect.promise(() => mkdir(join(root, "topics", "deep"), { recursive: true }));
				const result = yield* syncIndex(bundle, false);
				assert.deepStrictEqual([...result.written].sort(), ["index.md", "topics/deep/index.md", "topics/index.md"]);
				const topics = yield* Effect.promise(() => readFile(join(root, "topics", "index.md"), "utf8"));
				assert.ok(topics.includes("deep/index.md"));
				assert.strictEqual(topics, Derive.synthesizeIndex(bundle, "topics"));
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);

	it.effect("--dry-run computes the written/unchanged split without touching disk", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-index-dry-")));
			try {
				const concept = conceptAt("thing.md", "Thing");
				const bundle = LoadedBundle.make({
					root,
					files: [concept.path],
					directories: [],
					concepts: new Map([[concept.id, concept]]),
					indexes: new Map(),
					logs: new Map(),
					diagnostics: [],
				});
				const rendered = Derive.renderIndex("", [concept], { subdirectories: [] });
				// Pre-seed a matching index.md so THIS run is unchanged, and a
				// second stale write never happens under --dry-run.
				yield* Effect.promise(() => writeFile(join(root, "index.md"), rendered));

				const result = yield* syncIndex(bundle, true);
				assert.deepStrictEqual(result.written, []);
				assert.deepStrictEqual(result.unchanged, ["index.md"]);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "index.md"), "utf8")), rendered);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);

	it.effect("keeps a declared root frontmatter and never forces the spec constant over it (D6)", () => {
		const bareRoot = `${ROOT}/bare`;
		const handle = MemoryFileSystem.makeSync({
			[`${ROOT}/thing.md`]: "",
			[`${bareRoot}/thing.md`]: "",
		});
		const rootBundle = (root: string, frontmatter: string): LoadedBundle => {
			const concept = conceptAt("thing.md", "Thing");
			return LoadedBundle.make({
				root,
				files: [concept.path],
				directories: [],
				concepts: new Map([[concept.id, concept]]),
				indexes: new Map([
					["", IndexDocument.make({ path: "index.md", dir: "", sections: [], okfVersion: "0.3", frontmatter })],
				]),
				logs: new Map(),
				diagnostics: [],
			});
		};
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const declared = 'okf_version: "0.3"\ntitle: Acme retail analytics\nlicense: CC-BY-4.0';
			const bundle = rootBundle(ROOT, declared);
			const first = yield* syncIndex(bundle, false);
			assert.include(first.written, "index.md");
			const text = yield* fs.readFileString(`${ROOT}/index.md`);
			assert.isTrue(text.startsWith(`---\n${declared}\n---\n`));
			const second = yield* syncIndex(bundle, false);
			assert.include(second.unchanged, "index.md");
			assert.notInclude(second.written, "index.md");

			// control: a block declaring no okf_version gets the spec constant prepended and keeps its keys
			yield* syncIndex(rootBundle(bareRoot, "title: Acme"), false, undefined, OKF_SPEC_VERSION);
			const bare = yield* fs.readFileString(`${bareRoot}/index.md`);
			assert.match(bare, new RegExp(`^---\\nokf_version: ['"]${OKF_SPEC_VERSION}['"]\\ntitle: Acme\\n---\\n`));
		}).pipe(Effect.provide(Layer.mergeAll(handle.layer, Path.layer)));
	});

	const readRoot = Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return yield* fs.readFileString(`${ROOT}/index.md`);
	});

	it.effect("never stamps a version into an undeclared root unless the config names one (R4)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			yield* syncIndex(bundle, false);
			const bare = yield* readRoot;
			assert.isFalse(bare.includes("okf_version"));
			// control: the config key fills it
			yield* syncIndex(bundle, false, undefined, "0.3");
			assert.match(yield* readRoot, /^---\nokf_version: ['"]0\.3['"]\n---\n/);
		}).pipe(Effect.provide(projectPlatform(UNDECLARED_PROJECT))),
	);

	it.effect("never rewrites a declared version, whatever the config says (D6)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			const frontmatter = bundle.indexes.get("")?.frontmatter ?? "";
			assert.include(frontmatter, "okf_version: '0.2'");
			// the seed's body lags the rendered index, so the first run rewrites the body, never the declaration
			const first = yield* syncIndex(bundle, false, undefined, "0.3");
			assert.include(first.written, "index.md");
			const text = yield* readRoot;
			assert.isTrue(text.startsWith(`---\n${frontmatter}\n---\n`));
			assert.notInclude(text, "0.3");
			// control: the second run finds nothing to change, still with the config naming 0.3
			const reloaded = yield* Bundle.load({ root: ROOT });
			const second = yield* syncIndex(reloaded, false, undefined, "0.3");
			assert.include(second.unchanged, "index.md");
			assert.notInclude(second.written, "index.md");
		}).pipe(Effect.provide(projectPlatform(V02_PROJECT))),
	);
});

describe("syncIndex: an index.md swapped after the check (OKF 0.3 section 3.2, #460)", () => {
	const target = `${ROOT}/metrics/index.md`;
	const toLinkOut = (fs: FileSystem.FileSystem) =>
		Effect.gen(function* () {
			yield* fs.remove(target);
			yield* fs.symlink("/outside/index.md", target);
		});
	const seed = { ...mountProject(V03_PROJECT), [target]: "# Stale\n", "/outside/index.md": "# Outside\n" };
	const outcomes = [
		["open", "symlink-escape", "a link out is in place when the file is opened"],
		["lstat", "changed-during-read", "the path is swapped between its resolution and the identity compare"],
	] as const;
	for (const [method, reason, when] of outcomes) {
		it.effect(`skips it as ${reason} (${when}), and never reads or writes the file it was swapped for`, () => {
			const [layer, trap] = swapOn(seed, method, target, toLinkOut);
			return Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const bundle = yield* Bundle.load({ root: ROOT });
				trap.arm();
				const result = yield* syncIndex(bundle, false);
				assert.isTrue(trap.fired(), "the swap must have run");
				assert.deepStrictEqual(
					result.skipped.filter((entry) => entry.id === "metrics/index.md"),
					[{ id: "metrics/index.md", reason }],
				);
				assert.isFalse(result.written.includes("metrics/index.md"));
				assert.isFalse(result.unchanged.includes("metrics/index.md"));
				assert.strictEqual(yield* fs.readFileString("/outside/index.md"), "# Outside\n");
			}).pipe(Effect.provide(layer));
		});
	}
});

describe("syncIndex: a reserved index.md linked out of the bundle (OKF 0.3 section 3.2 rule 5)", () => {
	const LINKED = [`${ROOT}/index.md`, `${ROOT}/metrics/index.md`];
	const kinds = {
		escaping: { root: "/outside/index.md", sub: "/outside/metrics-index.md" },
		dangling: { root: "/outside/missing-index.md", sub: "/outside/missing-metrics-index.md" },
	} as const;

	const seedFor = (kind: keyof typeof kinds): MemoryFileSystemSeed => ({
		...mountProject(V03_PROJECT),
		[`${ROOT}/index.md`]: MemoryFileSystem.symlink(kinds[kind].root),
		[`${ROOT}/metrics/index.md`]: MemoryFileSystem.symlink(kinds[kind].sub),
		// Control: a symlinked index that stays inside the bundle is still synced.
		[`${ROOT}/computations/index.md`]: MemoryFileSystem.symlink(`${ROOT}/references/computations-index.md`),
		[`${ROOT}/references/computations-index.md`]: "# Stale\n",
		...(kind === "escaping" ? { "/outside/index.md": "# Outside\n", "/outside/metrics-index.md": "# Outside\n" } : {}),
	});

	for (const kind of ["escaping", "dangling"] as const) {
		for (const dryRun of [false, true]) {
			it.effect(`skips a ${kind} root and subdirectory index.md and never touches the link (dryRun ${dryRun})`, () => {
				const touched: Array<string> = [];
				return Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					// Positive control: the guard is armed, so a stray access would be caught and recorded.
					const probe = yield* Effect.flip(fs.readFileString("/outside/index.md"));
					assert.strictEqual(probe._tag, "PlatformError");
					assert.deepStrictEqual(touched, ["readFileString /outside/index.md"]);
					touched.length = 0;

					const bundle = yield* Bundle.load({ root: ROOT });
					const pending: Array<{ target: string; contents: string }> = [];
					const result = yield* syncIndex(bundle, dryRun, pending);
					assert.deepStrictEqual(result.skipped, [
						{ id: "index.md", reason: "symlink-escape" },
						{ id: "metrics/index.md", reason: "symlink-escape" },
					]);
					assert.isFalse(result.written.includes("index.md"));
					assert.isFalse(result.written.includes("metrics/index.md"));
					assert.isFalse(result.unchanged.includes("index.md"));
					assert.isFalse(result.unchanged.includes("metrics/index.md"));
					assert.deepStrictEqual(touched, []);
					for (const link of LINKED) assert.isFalse(pending.some((write) => write.target === link));
					// Control: the in-bundle symlinked index is still synced.
					assert.isTrue(result.written.includes("computations/index.md"));
					if (dryRun) assert.isTrue(pending.some((write) => write.target === `${ROOT}/computations/index.md`));
					else assert.notStrictEqual(yield* fs.readFileString(`${ROOT}/computations/index.md`), "# Stale\n");
				}).pipe(Effect.provide(seedPlatform(seedFor(kind), denyAccess(touched, LINKED))));
			});
		}
	}

	it.effect("leaves the files the links point at unchanged", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const bundle = yield* Bundle.load({ root: ROOT });
			const result = yield* syncIndex(bundle, false);
			assert.deepStrictEqual(
				result.skipped.map((entry) => entry.id),
				["index.md", "metrics/index.md"],
			);
			assert.strictEqual(yield* fs.readFileString("/outside/index.md"), "# Outside\n");
			assert.strictEqual(yield* fs.readFileString("/outside/metrics-index.md"), "# Outside\n");
			// Control: the same call writes the indexes that do not link out.
			assert.isTrue(result.written.includes("modules/index.md") || result.unchanged.includes("modules/index.md"));
		}).pipe(Effect.provide(seedPlatform(seedFor("escaping")))),
	);
});

describe("syncIndex an unreadable index.md (#512)", () => {
	const MOD = "---\ntype: Module\ntitle: A\n---\n\n# A\n";
	const DEC = "---\ntype: Decision\ntitle: D\n---\n\n# D\n";
	const ROOT_UNCLOSED = '---\nokf_version: "0.3"\ntitle: x\n\n# Project\n';
	const MODULES_BAD = "---\nnot: [closed\n---\n\n# Modules\n";
	const files = {
		"index.md": ROOT_UNCLOSED,
		"modules/a.md": MOD,
		"modules/index.md": MODULES_BAD,
		"decisions/d.md": DEC,
		"decisions/index.md": "# Stale\n",
	};
	const readText = (root: string, name: string) => Effect.promise(() => readFile(join(root, name), "utf8"));

	it.effect("is skipped, not rewritten, and a valid stale index is still written", () =>
		withRealBundle(files, (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const result = yield* syncIndex(bundle, false);
				assert.deepStrictEqual(result.skipped, [
					{ id: "index.md", reason: "index-unparseable" },
					{ id: "modules/index.md", reason: "index-unparseable" },
				]);
				assert.strictEqual(yield* readText(root, "index.md"), ROOT_UNCLOSED);
				assert.strictEqual(yield* readText(root, "modules/index.md"), MODULES_BAD);
				assert.deepStrictEqual(result.written, ["decisions/index.md"]);
			}),
		),
	);

	it.effect("a dry run plans no write for it either", () =>
		withRealBundle(files, (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const pending: Array<PendingWrite> = [];
				const result = yield* syncIndex(bundle, true, pending);
				assert.deepStrictEqual(
					result.skipped.map((entry) => entry.id),
					["index.md", "modules/index.md"],
				);
				assert.deepStrictEqual(
					pending.map((write) => write.target),
					[join(root, "decisions/index.md")],
				);
			}),
		),
	);
});

describe("syncIndex byte-order mark (#492)", () => {
	const BOM = "\uFEFF";
	const MOD = "---\ntype: Module\ntitle: A\n---\n\n# A\n";
	const STALE = "# Stale\n";
	const readBytes = (root: string, name: string) => Effect.promise(() => readFile(join(root, name)));

	it.effect("keeps a leading BOM when it rewrites a stale index.md (#492)", () =>
		Effect.gen(function* () {
			const twin = yield* withRealBundle({ "modules/a.md": MOD, "modules/index.md": STALE }, (root) =>
				Effect.gen(function* () {
					const bundle = yield* Bundle.load({ root });
					yield* syncIndex(bundle, false);
					return (yield* readBytes(root, "modules/index.md")).toString("utf8");
				}),
			);
			yield* withRealBundle({ "modules/a.md": MOD, "modules/index.md": `${BOM}${STALE}` }, (root) =>
				Effect.gen(function* () {
					const bundle = yield* Bundle.load({ root });
					const result = yield* syncIndex(bundle, false);
					assert.isTrue(result.written.includes("modules/index.md"));
					const bytes = yield* readBytes(root, "modules/index.md");
					assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
					assert.strictEqual(bytes.subarray(3).toString("utf8"), twin);
				}),
			);
		}),
	);

	it.effect("a BOM index.md that already matches the render is unchanged", () =>
		Effect.gen(function* () {
			const rendered = yield* withRealBundle({ "modules/a.md": MOD }, (root) =>
				Effect.gen(function* () {
					const bundle = yield* Bundle.load({ root });
					yield* syncIndex(bundle, false);
					return (yield* readBytes(root, "modules/index.md")).toString("utf8");
				}),
			);
			yield* withRealBundle({ "modules/a.md": MOD, "modules/index.md": `${BOM}${rendered}` }, (root) =>
				Effect.gen(function* () {
					const before = yield* readBytes(root, "modules/index.md");
					const bundle = yield* Bundle.load({ root });
					const result = yield* syncIndex(bundle, false);
					assert.isTrue(result.unchanged.includes("modules/index.md"));
					assert.isFalse(result.written.includes("modules/index.md"));
					assert.isTrue(before.equals(yield* readBytes(root, "modules/index.md")));
				}),
			);
		}),
	);

	it.effect("keeps the BOM on a CRLF index.md", () =>
		withRealBundle({ "modules/a.md": MOD, "modules/index.md": `${BOM}# Stale\r\n\r\nold\r\n` }, (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const result = yield* syncIndex(bundle, false);
				assert.isTrue(result.written.includes("modules/index.md"));
				const bytes = yield* readBytes(root, "modules/index.md");
				assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
				assert.notDeepEqual([...bytes.subarray(3, 6)], [0xef, 0xbb, 0xbf]);
				assert.isFalse(/(?<!\r)\n/.test(bytes.subarray(3).toString("utf8")), "CRLF kept after the BOM");
			}),
		),
	);

	it.effect("a new index.md gets no BOM", () =>
		withRealBundle({ "modules/a.md": MOD }, (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const result = yield* syncIndex(bundle, false);
				assert.isTrue(result.written.includes("modules/index.md"));
				assert.isTrue(result.written.includes("index.md"));
				for (const name of ["modules/index.md", "index.md"]) {
					const bytes = yield* readBytes(root, name);
					assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], name);
				}
			}),
		),
	);
});

describe("syncIndex line endings (#505)", () => {
	const MOD = "---\ntype: Module\ntitle: A\n---\n\n# A\n";
	const readText = (root: string, name: string) => Effect.promise(() => readFile(join(root, name), "utf8"));
	const bareLf = /(?<!\r)\n/;
	const toCrlf = (text: string) => text.replace(/\n/g, "\r\n");
	const lfRender = withRealBundle({ "modules/a.md": MOD }, (root) =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root });
			yield* syncIndex(bundle, false);
			return yield* readText(root, "modules/index.md");
		}),
	);

	it.effect("keeps CRLF when it rewrites a stale CRLF index.md (#505)", () =>
		Effect.gen(function* () {
			const twin = yield* lfRender;
			yield* withRealBundle({ "modules/a.md": MOD, "modules/index.md": "# Stale\r\n\r\nold\r\n" }, (root) =>
				Effect.gen(function* () {
					const bundle = yield* Bundle.load({ root });
					const result = yield* syncIndex(bundle, false);
					assert.isTrue(result.written.includes("modules/index.md"));
					const text = yield* readText(root, "modules/index.md");
					assert.isFalse(bareLf.test(text), "no bare LF");
					assert.strictEqual(text.replace(/\r\n/g, "\n"), twin);
				}),
			);
		}),
	);

	it.effect("a CRLF index.md that matches the render is unchanged (#505)", () =>
		Effect.gen(function* () {
			const twin = yield* lfRender;
			yield* withRealBundle({ "modules/a.md": MOD, "modules/index.md": toCrlf(twin) }, (root) =>
				Effect.gen(function* () {
					const bundle = yield* Bundle.load({ root });
					const result = yield* syncIndex(bundle, false);
					assert.isTrue(result.unchanged.includes("modules/index.md"));
					assert.isFalse(result.written.includes("modules/index.md"));
					assert.strictEqual(yield* readText(root, "modules/index.md"), toCrlf(twin));
				}),
			);
		}),
	);

	it.effect("a file that differs only in endings keeps its bytes, mixed or not (#505)", () =>
		Effect.gen(function* () {
			const twin = yield* lfRender;
			const mixed = twin.replace("\n", "\r\n");
			yield* withRealBundle({ "modules/a.md": MOD, "modules/index.md": mixed }, (root) =>
				Effect.gen(function* () {
					const bundle = yield* Bundle.load({ root });
					const result = yield* syncIndex(bundle, false);
					assert.isTrue(result.unchanged.includes("modules/index.md"));
					assert.strictEqual(yield* readText(root, "modules/index.md"), mixed);
				}),
			);
		}),
	);

	it.effect("control: a stale LF index.md is still written LF", () =>
		withRealBundle({ "modules/a.md": MOD, "modules/index.md": "# Stale\n" }, (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				yield* syncIndex(bundle, false);
				assert.isFalse((yield* readText(root, "modules/index.md")).includes("\r"));
			}),
		),
	);

	it.effect("a stale file whose first newline is LF but holds CRLF later is rewritten LF throughout", () =>
		withRealBundle({ "modules/a.md": MOD, "modules/index.md": "# Stale\nold\r\nmore\r\n" }, (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				yield* syncIndex(bundle, false);
				assert.isFalse((yield* readText(root, "modules/index.md")).includes("\r"));
			}),
		),
	);

	it.effect("a dry run plans the CRLF contents", () =>
		withRealBundle({ "modules/a.md": MOD, "modules/index.md": "# Stale\r\n" }, (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const pending: Array<PendingWrite> = [];
				yield* syncIndex(bundle, true, pending);
				const planned = pending.find((write) => write.target === join(root, "modules/index.md"));
				assert.isFalse(bareLf.test(planned?.contents ?? "x\n"));
			}),
		),
	);
});
