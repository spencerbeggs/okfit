import { FrontmatterSource, MarkdownEdit } from "@effected/markdown";
import type { YamlParseError } from "@effected/yaml";
import type { LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Derivation, Trust } from "@okfit/profiles";
import type { DateTime, PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";
import type { Digest } from "effect/crypto";
import { writeAtomic } from "../sync/write.js";
import { locateIntegrity, spliceIntegrityGenerated } from "../verify/integrity.js";
import { detectNewline, documentNewline, locateTopLevelScalar, stripBom } from "../verify/locate.js";
import { quoteLike } from "../verify/splice.js";
import type { MigrationCode, MigrationFinding, MigrationFixKind } from "./findings.js";
import { migrationFindings } from "./findings.js";

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
 * `integrity.generated.body` went stale because the `integrity` block has a layout the plan will not edit (never
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

const ROOT_INDEX = "index.md";

/** Splice the declaration into the root index's real text, or say why it cannot be done in place. */
const declareVersion = Effect.fn("okfit/migrate/declareVersion")(function* (source: string, target: string) {
	const { text, bom } = stripBom(source);
	const split = FrontmatterSource.split(text).frontmatter;
	if (split === undefined) {
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
 * same plan (R41), so a narrowed run never flips a bundle to a version under which its links break. For an edited
 * concept whose recorded `integrity.generated.body` equalled its body digest before the edit, the plan re-records
 * that one digest (a link repair, OKF 0.3 §5.2; R44); it never writes `generated.at`, `verified` or
 * `integrity.verified`.
 *
 * Unlike the brief's first sketch, this reads the root `index.md` itself (once, and only when the version fix is
 * planned), because `LoadedBundle` keeps only the frontmatter value of an index and the fix must locate `okf_version`
 * in the real text, BOM and CRLF included. So it requires the file system as well as `Digest`.
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
	const all = migrationFindings(bundle, config, target);
	const selected = all.filter(
		(finding): finding is MigrationFinding & { readonly fix: MigrationFixKind } =>
			finding.fix !== undefined &&
			(files === undefined || files.includes(finding.file)) &&
			(only === undefined || only.includes(finding.fix)),
	);
	const pathFixes = selected.filter((finding) => finding.fix === "root-relative-path");
	const allPathFindings = all.filter((finding) => finding.code === "root-relative-path").length;

	const edits: Array<{ path: string; text: string; fixes: Array<MigrationFixKind> }> = [];
	const refused: Array<{ file: string; code: MigrationCode; reason: string }> = [];
	const drifts = new Set<string>();
	// Findings this plan actually turns into an insert; a selected finding it cannot locate is refused, never counted.
	let fixed = 0;

	const byFile = new Map<string, Array<MigrationFinding & { readonly fix: MigrationFixKind }>>();
	for (const finding of pathFixes) byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]);
	for (const [file, found] of byFile) {
		const concept: LoadedConcept | undefined = [...bundle.concepts.values()].find((c) => c.path === file);
		const refuse = (finding: MigrationFinding, reason: string) =>
			refused.push({ file: finding.file, code: finding.code, reason });
		if (concept === undefined) {
			for (const finding of found) refuse(finding, "the concept is not loaded, so the reference cannot be rewritten");
			continue;
		}
		const source = concept.document.source;
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
		const recorded = concept.frontmatter.integrity?.generated?.body;
		if (recorded !== undefined && recorded === (yield* Derivation.bodyDigest(source))) {
			const next = yield* Derivation.bodyDigest(text);
			if (next !== recorded) {
				const { text: plain, bom } = stripBom(text);
				const located = yield* locateIntegrity(plain);
				if (located._tag === "unsupported") {
					// Never forge a digest: the body changed and the record is left stale, so list the concept.
					drifts.add(concept.path.slice(0, -3));
				} else {
					text =
						bom + MarkdownEdit.applyAll(plain, [spliceIntegrityGenerated(located, plain, next, detectNewline(plain))]);
				}
			}
		}
		// The loader reads through `readFileString`, which drops a leading BOM; give it back on write.
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const head = yield* fs.readFile(path.join(bundle.root, file));
		if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) text = `\uFEFF${text}`;
		edits.push({ path: file, text, fixes: applied });
		const signal = yield* Trust.signal(concept, config, now);
		if (signal.integrity === "current") drifts.add(concept.path.slice(0, -3));
	}
	const remaining = allPathFindings - fixed;

	const version = selected.find((finding) => finding.fix === "okf-version");
	if (version !== undefined) {
		if (remaining > 0) {
			refused.push({
				file: version.file,
				code: version.code,
				reason: `${remaining} reference(s) still resolve only from the bundle root; fix them first or run without --only/targets`,
			});
		} else {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			// Decode the bytes myself: `readFileString` may drop a leading BOM, and the write must give it back.
			const bytes = yield* fs.readFile(path.join(bundle.root, ROOT_INDEX));
			const source = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
			const declared = yield* declareVersion(source, target);
			if ("reason" in declared) refused.push({ file: version.file, code: version.code, reason: declared.reason });
			else edits.push({ path: ROOT_INDEX, text: declared.text, fixes: ["okf-version"] });
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
