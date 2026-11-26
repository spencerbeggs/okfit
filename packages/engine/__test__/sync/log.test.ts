import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
	DiagnosticRange,
	LoadedBundle,
	LoadedConcept,
	LogDocument,
	LogGroup,
	LogItem,
} from "@okfit/core";
import type { BodyProvenance } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Layer, Option, Result } from "effect";
import type { LogAddition } from "../../src/sync/log.js";
import { logWindow, mergeLog, syncLog, wantsLogEntry } from "../../src/sync/log.js";
import type { PendingWrite } from "../../src/sync/write.js";
import { V03_PROJECT } from "../fixtures/bundles.js";
import { ROOT, denyAccess, mountProject, seedPlatform } from "../utils/bundle.js";
import { withRealBundle } from "../utils/realBundle.js";

/**
 * One `## <date>` group as it would come out of `Bundle.load`'s
 * `parseLog`: `range` spans the heading through the byte just before the
 * next `## ` heading (or end of document for the last group) --
 * `internal/reserved.ts:193-206`'s own `flush`. `itemTexts` are only used
 * to build a plausible `LogItem` list; `mergeLog` never reads `items`,
 * only `range` (it re-emits the verbatim slice of `source`).
 */
const group = (source: string, date: string, itemTexts: ReadonlyArray<string>): LogGroup => {
	const offset = source.indexOf(`## ${date}`);
	if (offset === -1) throw new Error(`fixture source has no "## ${date}" heading`);
	const nextHeadingOffset = source.indexOf("\n## ", offset + 1);
	const end = nextHeadingOffset === -1 ? source.length : nextHeadingOffset + 1;
	return LogGroup.make({
		date,
		items: itemTexts.map((text) =>
			LogItem.make({ text, range: DiagnosticRange.fromOffset(source, offset, end - offset) }),
		),
		range: DiagnosticRange.fromOffset(source, offset, end - offset),
	});
};

describe("mergeLog", () => {
	it.effect("renders # Log and nothing else for an empty log with no additions", () =>
		Effect.sync(() => {
			assert.strictEqual(mergeLog(undefined, []), "# Log\n");
		}),
	);

	it.effect("creates one new group, newest first, for a brand-new date", () =>
		Effect.sync(() => {
			const additions: ReadonlyArray<LogAddition> = [
				{ date: "2026-09-01", title: "B", added: true },
				{ date: "2026-09-05", title: "A", added: true },
			];
			const result = mergeLog(undefined, additions);
			assert.strictEqual(result, "# Log\n\n## 2026-09-05\n\n* Added A\n\n## 2026-09-01\n\n* Added B\n");
		}),
	);

	it.effect("appends new items after an existing group's verbatim text, no deduplication", () =>
		Effect.sync(() => {
			const source = "# Log\n\n## 2026-09-01\n* Added Old\n";
			const doc = LogDocument.make({
				path: "log.md",
				dir: "",
				title: "Log",
				groups: [group(source, "2026-09-01", ["Added Old"])],
			});
			const additions: ReadonlyArray<LogAddition> = [{ date: "2026-09-01", title: "New Item", added: true }];
			const result = mergeLog({ doc, source }, additions);
			assert.strictEqual(result, "# Log\n\n## 2026-09-01\n* Added Old\n* Added New Item\n");
		}),
	);

	it.effect("sorts a new group's items by title, not by the Added/Updated prefix", () =>
		Effect.sync(() => {
			// Prefix-sort would put "Added Zeta" before "Updated Alpha" (A < U).
			// Title-sort must put Alpha before Zeta regardless of the prefix.
			const additions: ReadonlyArray<LogAddition> = [
				{ date: "2026-09-01", title: "Zeta", added: true },
				{ date: "2026-09-01", title: "Alpha", added: false },
			];
			const result = mergeLog(undefined, additions);
			assert.strictEqual(result, "# Log\n\n## 2026-09-01\n\n* Updated Alpha\n* Added Zeta\n");
		}),
	);

	it.effect("keeps every other existing group byte-identical when one group changes", () =>
		Effect.sync(() => {
			const source =
				"# Log\n\n## 2026-09-05\n* Added Newer\n\n## 2026-09-01\n* Added Old <!-- hand-written comment -->\n";
			const doc = LogDocument.make({
				path: "log.md",
				dir: "",
				title: "Log",
				groups: [
					group(source, "2026-09-05", ["Added Newer"]),
					group(source, "2026-09-01", ["Added Old <!-- hand-written comment -->"]),
				],
			});
			const additions: ReadonlyArray<LogAddition> = [{ date: "2026-09-05", title: "Another", added: true }];
			const result = mergeLog({ doc, source }, additions);
			assert.strictEqual(
				result,
				"# Log\n\n## 2026-09-05\n* Added Newer\n* Added Another\n\n## 2026-09-01\n* Added Old <!-- hand-written comment -->\n",
			);
		}),
	);

	it.effect("preserves a triple-newline gap between two untouched groups byte-for-byte", () =>
		Effect.sync(() => {
			// The gap between the two existing groups is three newlines (two
			// hand-written blank lines), not the usual one blank line -- S-10's
			// byte-copy discipline must reproduce it exactly, not normalise it.
			const source = "# Log\n\n## 2026-09-05\n* Added Newer\n\n\n## 2026-09-01\n* Added Old\n";
			const doc = LogDocument.make({
				path: "log.md",
				dir: "",
				title: "Log",
				groups: [group(source, "2026-09-05", ["Added Newer"]), group(source, "2026-09-01", ["Added Old"])],
			});
			// A brand-new date older than both existing ones: neither existing
			// group is touched, but the previously-last group (2026-09-01) now
			// needs its own separator before the new group that follows it.
			const additions: ReadonlyArray<LogAddition> = [{ date: "2026-08-01", title: "Brand New", added: true }];
			const result = mergeLog({ doc, source }, additions);
			assert.strictEqual(
				result,
				"# Log\n\n## 2026-09-05\n* Added Newer\n\n\n## 2026-09-01\n* Added Old\n\n## 2026-08-01\n\n* Added Brand New\n",
			);
		}),
	);
});

describe("mergeLog line endings (#505)", () => {
	it.effect("an item appended into a non-last CRLF group lands before the blank separator line", () =>
		Effect.sync(() => {
			const source = "# Log\r\n\r\n## 2026-09-05\r\n* Added Newer\r\n\r\n## 2026-09-01\r\n* Added Old\r\n";
			const doc = LogDocument.make({
				path: "log.md",
				dir: "",
				title: "Log",
				groups: [group(source, "2026-09-05", ["Added Newer"]), group(source, "2026-09-01", ["Added Old"])],
			});
			const result = mergeLog({ doc, source }, [{ date: "2026-09-05", title: "Another", added: true }]);
			assert.strictEqual(
				result,
				"# Log\n\n## 2026-09-05\n* Added Newer\n* Added Another\n\n## 2026-09-01\n* Added Old\n",
			);
		}),
	);

	it.effect("a mixed-ending source merges to LF throughout", () =>
		Effect.sync(() => {
			const source = "# Log\n\n## 2026-09-05\r\n* Added Newer\r\n\r\n## 2026-09-01\n* Added Old\n";
			const doc = LogDocument.make({
				path: "log.md",
				dir: "",
				title: "Log",
				groups: [group(source, "2026-09-05", ["Added Newer"]), group(source, "2026-09-01", ["Added Old"])],
			});
			const result = mergeLog({ doc, source }, [
				{ date: "2026-09-05", title: "Another", added: true },
				{ date: "2026-09-01", title: "Other", added: false },
			]);
			assert.strictEqual(
				result,
				"# Log\n\n## 2026-09-05\n* Added Newer\n* Added Another\n\n## 2026-09-01\n* Added Old\n* Updated Other\n",
			);
		}),
	);
});

describe("logWindow / wantsLogEntry (issue #18)", () => {
	const source = "# Log\n\n## 2026-09-08\n\n* Initialized the bundle\n* Added Thing\n\n## 2026-09-01\n\n* Added Old\n";
	const doc = LogDocument.make({
		path: "log.md",
		dir: "",
		title: "Log",
		groups: [
			group(source, "2026-09-08", ["Initialized the bundle", "Added Thing"]),
			group(source, "2026-09-01", ["Added Old"]),
		],
	});

	it.effect("defaults since to the newest logged date and indexes every item text by date", () =>
		Effect.sync(() => {
			const window = logWindow(doc, undefined);
			assert.strictEqual(window.since, "2026-09-08");
			assert.deepStrictEqual([...(window.named.get("2026-09-08") ?? [])], ["Initialized the bundle", "Added Thing"]);
		}),
	);

	it.effect("an explicit since replaces the default floor", () =>
		Effect.sync(() => {
			assert.strictEqual(logWindow(doc, "2026-08-01").since, "2026-08-01");
		}),
	);

	it.effect("has no floor and nothing named for a missing log", () =>
		Effect.sync(() => {
			const window = logWindow(undefined, undefined);
			assert.strictEqual(window.since, undefined);
			assert.strictEqual(window.named.size, 0);
		}),
	);

	it.effect("wants an entry on the newest logged day when no mechanical item names the concept", () =>
		Effect.sync(() => {
			const window = logWindow(doc, undefined);
			assert.strictEqual(wantsLogEntry(window, "2026-09-08", "Other"), true);
		}),
	);

	it.effect("refuses a duplicate on either mechanical spelling, but not on prose", () =>
		Effect.sync(() => {
			const window = logWindow(doc, undefined);
			assert.strictEqual(wantsLogEntry(window, "2026-09-08", "Thing"), false);
			const updated = logWindow(
				LogDocument.make({
					path: "log.md",
					dir: "",
					title: "Log",
					groups: [group("# Log\n\n## 2026-09-08\n\n* Updated Thing\n", "2026-09-08", ["Updated Thing"])],
				}),
				undefined,
			);
			assert.strictEqual(wantsLogEntry(updated, "2026-09-08", "Thing"), false);
			assert.strictEqual(wantsLogEntry(window, "2026-09-08", "Initialized the bundle"), true);
		}),
	);

	it.effect("refuses a date before since and accepts one after it", () =>
		Effect.sync(() => {
			const window = logWindow(doc, undefined);
			assert.strictEqual(wantsLogEntry(window, "2026-09-07", "Anything"), false);
			assert.strictEqual(wantsLogEntry(window, "2026-09-09", "Anything"), true);
		}),
	);
});

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

/** A committed `BodyProvenance`, built by hand -- `syncLog` never calls git itself. */
const committed = (iso: string, creating: boolean): BodyProvenance => ({
	_tag: "committed",
	at: DateTime.makeUnsafe(iso),
	sha: "0123456789abcdef0123456789abcdef01234567",
	committedAt: DateTime.makeUnsafe(iso),
	authorName: "Author",
	authorEmail: "author@example.com",
	creating,
});

const uncommitted = (reason: "untracked" | "dirty" | "unborn"): BodyProvenance => ({ _tag: "uncommitted", reason });

const emptyBundle = (root: string, overrides: Partial<Parameters<typeof LoadedBundle.make>[0]> = {}): LoadedBundle =>
	LoadedBundle.make({
		root,
		files: [],
		directories: [],
		concepts: new Map(),
		indexes: new Map(),
		logs: new Map(),
		diagnostics: [],
		...overrides,
	});

describe("syncLog", () => {
	it.effect("no existing log: creates # Log with additions from every committed concept", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-log-")));
			try {
				const concept = conceptAt("thing.md", "Thing");
				const bundle = emptyBundle(root, {
					files: [concept.path],
					concepts: new Map([[concept.id, concept]]),
				});
				const provenance = new Map([[concept.id, committed("2026-09-01T00:00:00Z", true)]]);

				const result = yield* syncLog(bundle, provenance, false);
				assert.deepStrictEqual(result, { selected: true, written: ["log.md"], unchanged: [], skipped: [] });
				assert.strictEqual(
					yield* Effect.promise(() => readFile(join(root, "log.md"), "utf8")),
					"# Log\n\n## 2026-09-01\n\n* Added Thing\n",
				);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);

	it.effect(
		"appends into the newest logged day when the concept is not yet named there; older dates and uncommitted concepts stay out",
		() =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-log-filter-")));
				try {
					const source = "# Log\n\n## 2026-09-01\n* Added Old\n";
					yield* Effect.promise(() => writeFile(join(root, "log.md"), source));
					const doc = LogDocument.make({
						path: "log.md",
						dir: "",
						title: "Log",
						groups: [group(source, "2026-09-01", ["Added Old"])],
					});
					const newer = conceptAt("newer.md", "Newer");
					const sameDay = conceptAt("same.md", "Same");
					const old = conceptAt("old.md", "Old");
					const older = conceptAt("older.md", "Older");
					const dirty = conceptAt("dirty.md", "Dirty");
					const bundle = emptyBundle(root, {
						files: [newer.path, sameDay.path, old.path, older.path, dirty.path],
						concepts: new Map([
							[newer.id, newer],
							[sameDay.id, sameDay],
							[old.id, old],
							[older.id, older],
							[dirty.id, dirty],
						]),
						logs: new Map([["", doc]]),
					});
					const provenance = new Map<ConceptId, BodyProvenance>([
						[newer.id, committed("2026-09-05T00:00:00Z", true)],
						[sameDay.id, committed("2026-09-01T00:00:00Z", true)],
						[old.id, committed("2026-09-01T00:00:00Z", true)],
						[older.id, committed("2026-08-15T00:00:00Z", true)],
						[dirty.id, uncommitted("dirty")],
					]);

					const result = yield* syncLog(bundle, provenance, false);
					assert.deepStrictEqual(result, { selected: true, written: ["log.md"], unchanged: [], skipped: [] });
					assert.strictEqual(
						yield* Effect.promise(() => readFile(join(root, "log.md"), "utf8")),
						"# Log\n\n## 2026-09-05\n\n* Added Newer\n\n## 2026-09-01\n* Added Old\n* Added Same\n",
					);
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}).pipe(Effect.provide(platform)),
	);

	it.effect("an explicit since widens the window to an older group without duplicating what it already names", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-log-since-")));
			try {
				const source = "# Log\n\n## 2026-09-01\n* Added Old\n";
				yield* Effect.promise(() => writeFile(join(root, "log.md"), source));
				const doc = LogDocument.make({
					path: "log.md",
					dir: "",
					title: "Log",
					groups: [group(source, "2026-09-01", ["Added Old"])],
				});
				const old = conceptAt("old.md", "Old");
				const older = conceptAt("older.md", "Older");
				const bundle = emptyBundle(root, {
					files: [old.path, older.path],
					concepts: new Map([
						[old.id, old],
						[older.id, older],
					]),
					logs: new Map([["", doc]]),
				});
				const provenance = new Map<ConceptId, BodyProvenance>([
					[old.id, committed("2026-09-01T00:00:00Z", true)],
					[older.id, committed("2026-08-15T00:00:00Z", true)],
				]);
				const result = yield* syncLog(bundle, provenance, false, "2026-08-01");
				assert.deepStrictEqual(result, { selected: true, written: ["log.md"], unchanged: [], skipped: [] });
				assert.strictEqual(
					yield* Effect.promise(() => readFile(join(root, "log.md"), "utf8")),
					"# Log\n\n## 2026-09-01\n* Added Old\n\n## 2026-08-15\n\n* Added Older\n",
				);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);

	it.effect("a log Bundle.load could not parse is skipped log-unparseable, with no write", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-log-unparseable-")));
			try {
				const source = "not a valid log heading\n";
				yield* Effect.promise(() => writeFile(join(root, "log.md"), source));
				// `bundle.logs` has no entry for "" -- simulates Bundle.load failing to
				// parse an existing file (contract §8.2 step 3).
				const bundle = emptyBundle(root);

				const result = yield* syncLog(bundle, new Map(), false);
				assert.deepStrictEqual(result, {
					selected: true,
					written: [],
					unchanged: [],
					skipped: [{ id: "log.md", reason: "log-unparseable" }],
				});
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "log.md"), "utf8")), source);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);

	it.effect("matching content is unchanged, with no write", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-log-unchanged-")));
			try {
				const source = "# Log\n\n## 2026-09-01\n* Added Old\n";
				yield* Effect.promise(() => writeFile(join(root, "log.md"), source));
				const doc = LogDocument.make({
					path: "log.md",
					dir: "",
					title: "Log",
					groups: [group(source, "2026-09-01", ["Added Old"])],
				});
				const bundle = emptyBundle(root, { logs: new Map([["", doc]]) });

				const result = yield* syncLog(bundle, new Map(), false);
				assert.deepStrictEqual(result, { selected: true, written: [], unchanged: ["log.md"], skipped: [] });
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "log.md"), "utf8")), source);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);

	it.effect("--dry-run classifies as written but never creates the file", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-log-dry-")));
			try {
				const concept = conceptAt("thing.md", "Thing");
				const bundle = emptyBundle(root, {
					files: [concept.path],
					concepts: new Map([[concept.id, concept]]),
				});
				const provenance = new Map([[concept.id, committed("2026-09-01T00:00:00Z", true)]]);

				const result = yield* syncLog(bundle, provenance, true);
				assert.deepStrictEqual(result, { selected: true, written: ["log.md"], unchanged: [], skipped: [] });
				const exists = yield* Effect.promise(() =>
					readFile(join(root, "log.md"), "utf8").then(
						() => true,
						() => false,
					),
				);
				assert.isFalse(exists);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);
});

describe("syncLog: a log.md linked out of the bundle (OKF 0.3 section 3.2 rule 5)", () => {
	const REVENUE = Option.getOrThrow(ConceptId.normalize("metrics/revenue.md"));
	const provenance = new Map([
		[REVENUE, { _tag: "committed", at: DateTime.makeUnsafe("2026-09-16T10:00:00Z"), creating: true } as const],
	]);
	const seedFor = (log: MemoryFileSystemSeed): MemoryFileSystemSeed => ({
		...mountProject(V03_PROJECT),
		"/outside/log.md": "# Outside log\n",
		...log,
	});
	const links = {
		escaping: { [`${ROOT}/log.md`]: MemoryFileSystem.symlink("/outside/log.md") },
		dangling: { [`${ROOT}/log.md`]: MemoryFileSystem.symlink("/outside/missing-log.md") },
	} as const;

	for (const kind of ["escaping", "dangling"] as const) {
		for (const dryRun of [false, true]) {
			it.effect(`skips a ${kind} log.md and never touches the link (dryRun ${dryRun})`, () => {
				const touched: Array<string> = [];
				return Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					// Positive control: the guard is armed.
					const probe = yield* Effect.flip(fs.readFileString("/outside/log.md"));
					assert.strictEqual(probe._tag, "PlatformError");
					assert.strictEqual(touched.length, 1);
					touched.length = 0;
					const bundle = yield* Bundle.load({ root: ROOT });
					const pending: Array<{ target: string; contents: string }> = [];
					const result = yield* syncLog(bundle, provenance, dryRun, undefined, pending);
					assert.deepStrictEqual(result.skipped, [{ id: "log.md", reason: "symlink-escape" }]);
					assert.deepStrictEqual(result.written, []);
					assert.deepStrictEqual(result.unchanged, []);
					assert.deepStrictEqual(pending, []);
					assert.deepStrictEqual(touched, []);
				}).pipe(Effect.provide(seedPlatform(seedFor(links[kind]), denyAccess(touched, [`${ROOT}/log.md`]))));
			});
		}
	}

	it.effect("leaves the file an escaping log.md points at unchanged", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const bundle = yield* Bundle.load({ root: ROOT });
			const result = yield* syncLog(bundle, provenance, false);
			assert.deepStrictEqual(result.skipped, [{ id: "log.md", reason: "symlink-escape" }]);
			assert.strictEqual(yield* fs.readFileString("/outside/log.md"), "# Outside log\n");
		}).pipe(Effect.provide(seedPlatform(seedFor(links.escaping)))),
	);

	it.effect("control: a plain log.md is merged", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const bundle = yield* Bundle.load({ root: ROOT });
			const result = yield* syncLog(bundle, provenance, false);
			assert.deepStrictEqual(result.written, ["log.md"]);
			assert.deepStrictEqual(result.skipped, []);
			assert.include(yield* fs.readFileString(`${ROOT}/log.md`), "Added Revenue");
		}).pipe(Effect.provide(seedPlatform(seedFor({ [`${ROOT}/log.md`]: "# Log\n" })))),
	);
});

describe("syncLog byte-order mark (#492)", () => {
	const OLD = "# Log\n\n## 2026-08-01\n\n* Added Old\n";
	const MOD = (title: string) => `---\ntype: Module\ntitle: ${title}\n---\n\n# ${title}\n`;
	const files = { "old.md": MOD("Old"), "new.md": MOD("Fresh"), "log.md": `\uFEFF${OLD}` };

	it.effect("keeps a leading BOM when it rewrites log.md (#492)", () =>
		withRealBundle(files, (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const id = Option.getOrThrow(ConceptId.normalize("new.md"));
				const provenance = new Map([[id, committed("2026-09-01T00:00:00Z", true)]]);
				const result = yield* syncLog(bundle, provenance, false);
				assert.deepStrictEqual(result.written, ["log.md"]);
				const bytes = yield* Effect.promise(() => readFile(join(root, "log.md")));
				assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
				const text = bytes.subarray(3).toString("utf8");
				assert.isTrue(text.startsWith("# Log\n"), "exactly one BOM, then the heading");
				assert.isTrue(text.includes("* Added Fresh"));
				assert.isTrue(text.endsWith(OLD.slice("# Log\n\n".length)));
			}),
		),
	);

	it.effect("a BOM log.md that already matches the merge is unchanged", () =>
		withRealBundle(files, (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const before = yield* Effect.promise(() => readFile(join(root, "log.md")));
				const result = yield* syncLog(bundle, new Map(), false);
				assert.deepStrictEqual(result.unchanged, ["log.md"]);
				assert.isTrue(before.equals(yield* Effect.promise(() => readFile(join(root, "log.md")))));
			}),
		),
	);
});

describe("syncLog line endings (#505)", () => {
	const MOD = (title: string) => `---\ntype: Module\ntitle: ${title}\n---\n\n# ${title}\n`;
	const CRLF_LOG = "# Log\r\n\r\n## 2026-09-05\r\n\r\n* Added Newer\r\n\r\n## 2026-09-01\r\n\r\n* Added Old\r\n";
	const bareLf = /(?<!\r)\n/;
	const readText = (root: string) => Effect.promise(() => readFile(join(root, "log.md"), "utf8"));
	const files = (log: string) => ({
		"newer.md": MOD("Newer"),
		"fresh.md": MOD("Fresh"),
		"fresh2.md": MOD("Fresh2"),
		"log.md": log,
	});
	const provenanceFor = (entries: ReadonlyArray<readonly [string, string]>) =>
		new Map(
			entries.map(([file, iso]) => [Option.getOrThrow(ConceptId.normalize(file)), committed(iso, true)] as const),
		);

	it.effect("keeps CRLF when it appends to the last and a non-last group (#505)", () =>
		withRealBundle(files(CRLF_LOG), (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const provenance = provenanceFor([
					["fresh.md", "2026-09-05T00:00:00Z"],
					["fresh2.md", "2026-09-01T00:00:00Z"],
				]);
				const result = yield* syncLog(bundle, provenance, false, "2026-09-01");
				assert.deepStrictEqual(result.written, ["log.md"]);
				const text = yield* readText(root);
				assert.isFalse(bareLf.test(text), "no bare LF");
				assert.strictEqual(
					text,
					"# Log\r\n\r\n## 2026-09-05\r\n\r\n* Added Newer\r\n* Added Fresh\r\n\r\n## 2026-09-01\r\n\r\n* Added Old\r\n* Added Fresh2\r\n",
				);
			}),
		),
	);

	it.effect("a dry run plans CRLF contents for a CRLF log.md (#505)", () =>
		withRealBundle(files(CRLF_LOG), (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const provenance = provenanceFor([["fresh.md", "2026-09-05T00:00:00Z"]]);
				const pending: Array<PendingWrite> = [];
				const result = yield* syncLog(bundle, provenance, true, "2026-09-01", pending);
				assert.deepStrictEqual(result.written, ["log.md"]);
				assert.strictEqual(pending.length, 1);
				const planned = pending[0]?.contents ?? "";
				assert.include(planned, "* Added Fresh\r\n");
				assert.isFalse(bareLf.test(planned), "no bare LF in the plan");
				assert.strictEqual(yield* readText(root), CRLF_LOG, "a dry run writes nothing");
			}),
		),
	);

	it.effect("a CRLF log.md with nothing to add is unchanged (#505)", () =>
		withRealBundle(files(CRLF_LOG), (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const result = yield* syncLog(bundle, new Map(), false);
				assert.deepStrictEqual(result.unchanged, ["log.md"]);
				assert.strictEqual(yield* readText(root), CRLF_LOG);
			}),
		),
	);

	it.effect("a mixed-ending log.md with nothing to add keeps its bytes", () =>
		withRealBundle(files("# Log\n\n## 2026-09-05\r\n\r\n* Added Newer\r\n"), (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const result = yield* syncLog(bundle, new Map(), false);
				assert.deepStrictEqual(result.unchanged, ["log.md"]);
				assert.strictEqual(yield* readText(root), "# Log\n\n## 2026-09-05\r\n\r\n* Added Newer\r\n");
			}),
		),
	);

	it.effect("a mixed-ending log.md that must be rewritten follows its first newline (#505)", () =>
		withRealBundle(files("# Log\n\n## 2026-09-05\r\n\r\n* Added Newer\r\n"), (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const provenance = provenanceFor([["fresh.md", "2026-09-05T00:00:00Z"]]);
				yield* syncLog(bundle, provenance, false);
				assert.strictEqual(yield* readText(root), "# Log\n\n## 2026-09-05\n\n* Added Newer\n* Added Fresh\n");
			}),
		),
	);

	it.effect("control: an LF log.md is still written LF", () =>
		withRealBundle(files("# Log\n\n## 2026-09-05\n\n* Added Newer\n"), (root) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root });
				const provenance = provenanceFor([["fresh.md", "2026-09-05T00:00:00Z"]]);
				yield* syncLog(bundle, provenance, false);
				assert.isFalse((yield* readText(root)).includes("\r"));
			}),
		),
	);
});
