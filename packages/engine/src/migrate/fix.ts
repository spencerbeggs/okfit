import { FrontmatterSource, MarkdownEdit } from "@effected/markdown";
import type { YamlParseError } from "@effected/yaml";
import type { LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Trust } from "@okfit/profiles";
import type { DateTime, PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";
import type { Digest } from "effect/crypto";
import { rerecordBodyDigest } from "../edits/bodyDigest.js";
import type { ReferenceSource } from "../move/references.js";
import { readMarkdownSources } from "../move/sources.js";
import { keyRenamesFor, legacyIntegrity } from "../sync/legacyKeys.js";
import { bomOf, writeAtomic } from "../sync/write.js";
import { detectNewline, documentNewline, locateTopLevelScalar, stripBom } from "../verify/locate.js";
import { quoteLike } from "../verify/splice.js";
import type { MigrationCode, MigrationFinding, MigrationFixKind } from "./findings.js";
import { ROOT_INDEX, migrationFindings, rootIndexUnclosed } from "./findings.js";

/**
 * What to fix and how far. `files` are bundle-relative paths already resolved by the caller (absent: the whole
 * bundle); `only` narrows by fix kind (absent: both kinds).
 *
 * @public
 */
export interface MigrationFixOptions {
	readonly bundle: LoadedBundle;
	readonly config: OkfitConfig;
	readonly target: string;
	readonly files?: ReadonlyArray<string>;
	readonly only?: ReadonlyArray<MigrationFixKind>;
	readonly now: DateTime.Utc;
}

/**
 * The fixes {@link planMigrationFixes} would write. `edits` holds each changed file's bundle-relative path, its full
 * new text and the fix kinds applied (one entry per fixed finding); `refused` lists a finding whose fix was not
 * planned, with the reason (including a selected reference the plan could not locate); `drifts` lists the sorted ids
 * whose human integrity was `current` and whose authored content changes, and the ids whose recorded
 * `x-okfit-integrity.generated.body` went stale because the `integrity` block has a layout the plan will not edit (never
 * repaired, only listed).
 *
 * @public
 */
export interface MigrationFixPlan {
	readonly edits: ReadonlyArray<{
		readonly path: string;
		readonly text: string;
		readonly fixes: ReadonlyArray<MigrationFixKind>;
	}>;
	readonly refused: ReadonlyArray<{
		readonly file: string;
		readonly code: MigrationCode;
		readonly reason: string;
	}>;
	readonly drifts: ReadonlyArray<string>;
}

interface Refusal {
	file: string;
	code: MigrationCode;
	reason: string;
}

/** The first line of a parser message, trimmed and capped, so a refusal reason stays one short line. */
const shortDetail = (message: string): string => {
	const first = (message.split("\n")[0] ?? "").trim().replace(/[.;]+$/, "");
	return first.length > 80 ? `${first.slice(0, 77)}...` : first;
};

/** Splice the declaration into the root index's real text, or say why it cannot be done in place. */
const declareVersion = Effect.fn("okfit/migrate/declareVersion")(function* (source: string, target: string) {
	const { text, bom } = stripBom(source);
	const split = FrontmatterSource.split(text).frontmatter;
	if (split === undefined) {
		// A first line of `---` plus spaces or tabs is a fence the splitter rejects: prepending a block would leave two
		// declarations in one file, so leave it to the author.
		if (/^---[ \t]+(?:\r?\n|$)/.test(text)) {
			return { reason: 'the opening fence is not exactly "---"; fix it by hand' };
		}
		const newline = detectNewline(text);
		return { text: `${bom}---${newline}okf_version: "${target}"${newline}---${newline}${text}` };
	}
	const newline = documentNewline(text);
	const located = yield* locateTopLevelScalar(text, "okf_version");
	if (located._tag === "replaceScalar") {
		// A plain scalar is written double-quoted; a quoted one keeps its quote style.
		const content = quoteLike(located.quote === "plain" ? "double-quoted" : located.quote, target);
		const edit = MarkdownEdit.make({ offset: located.start, length: located.end - located.start, content });
		return { text: bom + MarkdownEdit.applyAll(text, [edit]) };
	}
	const absent =
		located._tag === "insertAfterKey" ||
		located.shape === "no-anchor-key" ||
		(located.shape === "not-a-mapping" && split.value.trim() === "");
	if (!absent) return { reason: `okf_version cannot be edited in place (${located.shape}); edit it by hand` };
	const at = 3 + newline.length;
	const edit = MarkdownEdit.make({ offset: at, length: 0, content: `okf_version: "${target}"${newline}` });
	return { text: bom + MarkdownEdit.applyAll(text, [edit]) };
});

/**
 * Plan the two safe fixes (OKF 0.3 §6.2, §8.1): root a reference that resolves only through the v0.2 root fallback
 * (inserting `/` before its path part and changing nothing else), and declare `okf_version`. Writes nothing. The
 * version fix is refused, with its reason, while any root-only reference elsewhere in the bundle is not fixed by this
 * same plan (R41), so a narrowed run never flips a bundle to a version under which its links break. It is also refused
 * while any `computation-locator` warning stands (an Attested Computation the target would read as having no
 * computation, §10.3), wherever it is and whatever `files`/`only` select, and while a Markdown file's links could not be
 * scanned (unclosed or unparseable frontmatter). Each cause gets its own refusal. A root-only link in a non-concept
 * Markdown file (an index, a log, a typeless file) is rooted like a concept's, with no integrity re-record. For an edited
 * concept whose recorded `x-okfit-integrity.generated.body` equalled its body digest before the edit, the plan re-records
 * that one digest (a link repair, OKF 0.3 §5.2; R44); it never writes `generated.at`, `verified` or
 * `x-okfit-integrity.verified`.
 *
 * A root index whose frontmatter opens with `---` but never closes is refused with its own reason, before the file is
 * read (a version splice has no closing fence to anchor on). One that does not parse (`frontmatter-unparseable`, or a
 * YAML error found when the version is spliced in) is refused with a reason of its own; both are fixed by hand. The version finding carries its `okf-version` fix for an unclosed root index so this refusal
 * is reachable (#482); with no root `index.md` at all it carries none (R42).
 *
 * A refusal for lost computations also names the way out that is the author's: setting `okf_version` in `index.md` by
 * hand, after which the lint `computation-missing` reports each prose-only section. This plan never makes that edit.
 *
 * It reads files itself rather than trusting `LoadedBundle` alone: every non-concept Markdown file (indexes, logs and
 * typeless files, through `readMarkdownSources`) so their links are scanned, and the root `index.md` (only when the
 * version fix is planned), because `LoadedBundle` keeps only the frontmatter value of an index and the fix must locate
 * `okf_version` in the real text, BOM and CRLF included. So it requires the file system as well as `Digest`.
 *
 * @public
 */
export const planMigrationFixes = Effect.fn("okfit/migrate/plan")(function* (
	options: MigrationFixOptions,
): Effect.fn.Return<
	MigrationFixPlan,
	YamlParseError | PlatformError.PlatformError,
	FileSystem.FileSystem | Path.Path | Digest.Digest
> {
	const { bundle, config, target, files, only, now } = options;
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const { sources, unreadable } = yield* readMarkdownSources(bundle, { reserved: true });
	const all = migrationFindings(bundle, config, target, sources);
	const selected = all.filter(
		(finding): finding is MigrationFinding & { readonly fix: MigrationFixKind } =>
			finding.fix !== undefined &&
			(files === undefined || files.includes(finding.file)) &&
			(only === undefined || only.includes(finding.fix)),
	);
	const pathFixes = selected.filter((finding) => finding.fix === "root-relative-path");
	const allPathFindings = all.filter((finding) => finding.code === "root-relative-path").length;

	const edits: Array<{ path: string; text: string; fixes: Array<MigrationFixKind> }> = [];
	const refused: Array<Refusal> = [];
	const drifts = new Set<string>();
	// Findings this plan actually turns into an insert; a selected finding it cannot locate is refused, never counted.
	let fixed = 0;

	// Computed once: a concept still carrying okfit's pre-namespace integrity block is never edited here.
	const renames = keyRenamesFor(config);

	const byFile = new Map<string, Array<MigrationFinding & { readonly fix: MigrationFixKind }>>();
	for (const finding of pathFixes) byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]);
	for (const [file, found] of byFile) {
		const concept: LoadedConcept | undefined = [...bundle.concepts.values()].find((c) => c.path === file);
		const other = concept === undefined ? sources.find((candidate) => candidate.path === file) : undefined;
		const refuse = (finding: MigrationFinding, reason: string) =>
			refused.push({ file: finding.file, code: finding.code, reason });
		if (concept === undefined && other === undefined) {
			for (const finding of found) refuse(finding, "the concept is not loaded, so the reference cannot be rewritten");
			continue;
		}
		if (concept !== undefined && legacyIntegrity(concept, renames) !== undefined) {
			// An edit would leave the old block's body digest stale, and the next sync would read that as an authored
			// change and re-stamp the concept; the key rename has to come first.
			for (const finding of found) {
				refuse(
					finding,
					"the concept still uses okfit's old key names, so its recorded digest cannot be kept current; run `okfit sync` first, then fix again",
				);
			}
			continue;
		}
		const document = (concept ?? (other as ReferenceSource)).document;
		const source = document.source;
		const inserts: Array<MarkdownEdit> = [];
		const applied: Array<MigrationFixKind> = [];
		for (const finding of found) {
			if (finding.range === undefined) {
				refuse(finding, "the reference has no located range, so it cannot be rewritten");
				continue;
			}
			// The range covers the raw value; the path part starts after any leading whitespace.
			const raw = source.slice(finding.range.offset, finding.range.offset + finding.range.length);
			const offset = finding.range.offset + (raw.length - raw.trimStart().length);
			inserts.push(MarkdownEdit.make({ offset, length: 0, content: "/" }));
			applied.push(finding.fix);
		}
		if (inserts.length === 0) continue;
		fixed += inserts.length;
		let text = MarkdownEdit.applyAll(source, inserts);
		if (concept !== undefined) {
			const kept = yield* rerecordBodyDigest({
				recorded: concept.frontmatter.integrity?.generated?.body,
				before: source,
				after: text,
			});
			text = kept.text;
			// Never forge a digest: the body changed and the record is left stale, so list the concept.
			if (kept.outcome === "unrecordable") drifts.add(concept.path.slice(0, -3));
		}
		// The loader reads through `readFileString`, which drops a leading BOM; give it back on write.
		const bom = yield* bomOf(fs, path.join(bundle.root, file));
		if (!text.startsWith("\uFEFF")) text = bom + text;
		edits.push({ path: file, text, fixes: applied });
		if (concept !== undefined) {
			const signal = yield* Trust.signal(concept, config, now);
			if (signal.integrity === "current") drifts.add(concept.path.slice(0, -3));
		}
	}
	const remaining = allPathFindings - fixed;

	const version = selected.find((finding) => finding.fix === "okf-version");
	if (version !== undefined) {
		const refuseVersion = (reason: string) => refused.push({ file: version.file, code: version.code, reason });
		// A computation the target would not read stays lost once the version is declared, and the locator finding
		// stops being reported then, so the version waits for the author: wherever the concept is, whatever is selected.
		const lost = [
			...new Set(
				all
					.filter((finding) => finding.code === "computation-locator" && finding.severity === "warning")
					.map((finding) => finding.file),
			),
		].sort();
		// Each cause refuses on its own, so one run names every reason the version cannot be declared yet.
		// An unclosed root index has no closing fence to splice before, so it gets its own reason instead of the generic one.
		const unclosedRoot = rootIndexUnclosed(bundle);
		const unreadableHere = unclosedRoot ? unreadable.filter((file) => file !== ROOT_INDEX) : unreadable;
		const causes = [
			remaining > 0
				? `${remaining} reference(s) still resolve only from the bundle root; fix them first or run without --only/targets`
				: undefined,
			lost.length > 0
				? `${lost.length} Attested Computation(s) would have no computation under OKF ${target} (§10.3): ${lost.join(", ")}; put each computation in a fenced block or set computation, then fix again. To keep a prose-only Computation section anyway, set okf_version: "${target}" in index.md by hand; the lint computation-missing then reports each one`
				: undefined,
			// A Markdown file whose links could not be scanned may hold a root-only link the report never saw.
			unreadableHere.length > 0
				? `${unreadableHere.length} Markdown file(s) could not be read to check their links (unclosed or unparseable frontmatter): ${unreadableHere.join(", ")}; fix them first`
				: undefined,
			unclosedRoot
				? "the root index frontmatter opens with --- but never closes; add the closing --- by hand, then fix again"
				: undefined,
		].filter((cause) => cause !== undefined);
		for (const cause of causes) refuseVersion(cause);
		if (causes.length === 0) {
			// A frontmatter the loader already could not read (malformed YAML, a duplicate key) is never edited: a splice
			// would leave a file that still does not parse.
			const loadError = bundle.diagnostics.find((d) => d.file === ROOT_INDEX && d.code === "frontmatter-unparseable");
			const unparseable = (detail: string) =>
				`the root index frontmatter does not parse (${shortDetail(detail)}); fix it by hand`;
			if (loadError !== undefined) {
				refuseVersion(unparseable(loadError.message));
			} else {
				// Decode the bytes myself: `readFileString` may drop a leading BOM, and the write must give it back.
				const bytes = yield* fs.readFile(path.join(bundle.root, ROOT_INDEX));
				const source = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
				const declared = yield* declareVersion(source, target).pipe(
					Effect.catchTag("YamlParseError", (error) => Effect.succeed({ reason: unparseable(error.message) })),
				);
				if ("reason" in declared) refuseVersion(declared.reason);
				else edits.push({ path: ROOT_INDEX, text: declared.text, fixes: ["okf-version"] });
			}
		}
	}

	edits.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return { edits, refused, drifts: [...drifts].sort() };
});

/**
 * Plan the fixes, then (unless `dryRun`) write every edit with an atomic write, only after the whole plan is built.
 * `dryRun` returns the same plan and touches nothing.
 *
 * @public
 */
export const applyMigrationFixes = Effect.fn("okfit/migrate/apply")(function* (
	options: MigrationFixOptions & { readonly dryRun: boolean },
): Effect.fn.Return<
	MigrationFixPlan,
	YamlParseError | PlatformError.PlatformError,
	FileSystem.FileSystem | Path.Path | Digest.Digest
> {
	const path = yield* Path.Path;
	const plan = yield* planMigrationFixes(options);
	if (!options.dryRun) {
		for (const edit of plan.edits) yield* writeAtomic(path.join(options.bundle.root, edit.path), edit.text);
	}
	return plan;
});
