import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import {
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
import { DateTime, Effect, Layer, Option, Result } from "effect";
import type { LogAddition } from "../../src/sync/log.js";
import { mergeLog, syncLog } from "../../src/sync/log.js";

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
		"only a strictly-newer committed date is appended; an equal or older date and an uncommitted concept are excluded",
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
					const equal = conceptAt("equal.md", "Equal");
					const older = conceptAt("older.md", "Older");
					const dirty = conceptAt("dirty.md", "Dirty");
					const bundle = emptyBundle(root, {
						files: [newer.path, equal.path, older.path, dirty.path],
						concepts: new Map([
							[newer.id, newer],
							[equal.id, equal],
							[older.id, older],
							[dirty.id, dirty],
						]),
						logs: new Map([["", doc]]),
					});
					const provenance = new Map<ConceptId, BodyProvenance>([
						[newer.id, committed("2026-09-05T00:00:00Z", true)],
						[equal.id, committed("2026-09-01T00:00:00Z", true)],
						[older.id, committed("2026-08-15T00:00:00Z", true)],
						[dirty.id, uncommitted("dirty")],
					]);

					const result = yield* syncLog(bundle, provenance, false);
					assert.deepStrictEqual(result, { selected: true, written: ["log.md"], unchanged: [], skipped: [] });
					assert.strictEqual(
						yield* Effect.promise(() => readFile(join(root, "log.md"), "utf8")),
						"# Log\n\n## 2026-09-05\n\n* Added Newer\n\n## 2026-09-01\n* Added Old\n",
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
