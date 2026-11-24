import type { DiagnosticSeverity, LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Bundle, DiagnosticRange, Graph, OkfVersion } from "@okfit/core";
import { Option } from "effect";
import { referencesOf } from "../move/references.js";

/**
 * What a bundle holds that reads differently under a target OKF version.
 *
 * @public
 */
export type MigrationCode =
	| "okf-version-undeclared"
	| "okf-version-older"
	| "okf-version-unparsable"
	| "root-relative-path"
	| "computation-locator";

/**
 * Which of the two safe fixes would apply to a finding: declaring `okf_version`, or rooting a reference that
 * resolves only through the v0.2 root fallback.
 *
 * @public
 */
export type MigrationFixKind = "okf-version" | "root-relative-path";

/**
 * One thing that reads differently under the target version. `file` is bundle-relative (a bundle-level finding
 * names the file it belongs in, `index.md` for the version), `range` is zero-based, and `fix` only names which fix
 * kind would apply; it writes nothing. A version finding's `range.offset` is exact only for an LF root index
 * without a BOM, because it is computed from the frontmatter text without the file's source; a fix must locate
 * the `okf_version` scalar in the real file text instead of trusting it.
 *
 * @public
 */
export interface MigrationFinding {
	readonly file: string;
	readonly range?: DiagnosticRange;
	readonly code: MigrationCode;
	readonly severity: DiagnosticSeverity;
	readonly message: string;
	readonly fix?: MigrationFixKind;
}

/** The bundle-relative path of the root index, where the version lives. */
export const ROOT_INDEX = "index.md";

/** The range of the `okf_version` value line inside the root index's frontmatter text, assuming `---` and LF. */
const versionRange = (frontmatter: string | undefined): DiagnosticRange | undefined => {
	if (frontmatter === undefined) return undefined;
	const lines = frontmatter.split("\n");
	const at = lines.findIndex((line) => /^okf_version\s*:/.test(line));
	if (at < 0) return undefined;
	const line = lines[at] as string;
	const colon = line.indexOf(":");
	const value = line.slice(colon + 1);
	const character = colon + 1 + (value.length - value.trimStart().length);
	// The opening fence is `---` plus one line break; every earlier frontmatter line is its text plus one.
	const offset = 4 + lines.slice(0, at).reduce((sum, previous) => sum + previous.length + 1, 0) + character;
	return DiagnosticRange.make({ offset, length: value.trim().length, line: at + 1, character });
};

const versionFindings = (bundle: LoadedBundle, target: string): ReadonlyArray<MigrationFinding> => {
	const root = bundle.indexes.get("");
	const declared = OkfVersion.declared(bundle);
	if (Option.isNone(declared)) {
		return [
			{
				file: ROOT_INDEX,
				code: "okf-version-undeclared",
				severity: "warning",
				message:
					"okf_version is not declared; OKF 0.3 §8.1 asks a bundle to declare it, and okfit reads an undeclared bundle with the v0.2 fallbacks",
				// R42: with no root index there is nowhere to write the declaration.
				...(root === undefined ? {} : { fix: "okf-version" as const }),
			},
		];
	}
	const range = versionRange(root?.frontmatter);
	const withRange = range === undefined ? {} : { range };
	const version = OkfVersion.parse(declared.value);
	if (Option.isNone(version)) {
		return [
			{
				file: ROOT_INDEX,
				...withRange,
				code: "okf-version-unparsable",
				severity: "warning",
				message: `okf_version "${declared.value}" is not a <major>.<minor> version; fix it by hand`,
			},
		];
	}
	const wanted = OkfVersion.parse(target);
	if (Option.isSome(wanted) && OkfVersion.compare(version.value, wanted.value) < 0) {
		return [
			{
				file: ROOT_INDEX,
				...withRange,
				code: "okf-version-older",
				severity: "warning",
				message: `okf_version "${declared.value}" is older than ${target}`,
				fix: "okf-version",
			},
		];
	}
	return [];
};

/** References that resolve only from the bundle root under the v0.2 rule and dangle under the current one. */
const rootRelativeFindings = (
	bundle: LoadedBundle,
	config: OkfitConfig,
	target: string,
): ReadonlyArray<MigrationFinding> => {
	const found: Array<MigrationFinding> = [];
	for (const concept of bundle.concepts.values()) {
		const source = concept.document.source;
		for (const reference of referencesOf(concept, config).references) {
			const raw = reference.raw.trim();
			const legacy = Graph.resolve(bundle, concept.path, raw, reference.field, "legacy");
			// A value neither rooted nor explicit only lands through the root fallback when `via` is "root".
			if (legacy._tag !== "node" || legacy.kind === "missing" || legacy.via !== "root") continue;
			const current = Graph.resolve(bundle, concept.path, raw, reference.field, "current");
			// A `sources.resource` that misses reads as a descriptor, so the edge it had under v0.2 is lost the same way.
			const lost = current._tag === "descriptor" || (current._tag === "node" && current.kind === "missing");
			if (!lost) continue;
			found.push({
				file: concept.path,
				range: DiagnosticRange.fromOffset(source, reference.offset, reference.length),
				code: "root-relative-path",
				severity: "warning",
				message: `${reference.field ?? "link"} "${reference.raw}" resolves only from the bundle root, which OKF ${target} does not do (§6.2); write it as "/${raw}"`,
				fix: "root-relative-path",
			});
		}
	}
	return found;
};

const computationFinding = (concept: LoadedConcept, target: string): MigrationFinding | undefined => {
	const attested = concept.frontmatter.attested;
	if (attested?.runtime === undefined || attested.computation !== undefined) return undefined;
	const legacy = Bundle.inlineComputation(concept.document, "legacy");
	const current = Bundle.inlineComputation(concept.document, "current");
	if (Option.isNone(legacy) && Option.isNone(current)) return undefined;
	if (Option.isSome(legacy) && Option.isSome(current) && legacy.value === current.value) return undefined;
	const reading = Option.isNone(current)
		? "no fenced block, so the computation is missing"
		: Option.isNone(legacy)
			? "the first fenced block at any heading level"
			: "the first fenced block only";
	const heading = Option.orElse(concept.document.sectionByHeading("Computation", { depth: 1 }), () =>
		concept.document.sectionByHeading("Computation"),
	);
	const range = Option.match(heading, {
		onNone: () => undefined,
		onSome: ({ heading: node }) =>
			DiagnosticRange.fromOffset(
				concept.document.source,
				node.position.start.offset,
				node.position.end.offset - node.position.start.offset,
			),
	});
	return {
		file: concept.path,
		...(range === undefined ? {} : { range }),
		code: "computation-locator",
		// Lost under the target: the concept would stop carrying a computation; otherwise only which block is read changes.
		severity: Option.isNone(current) ? "warning" : "info",
		message: `The Computation section reads differently under OKF ${target} (§10.3): ${reading}`,
	};
};

const compare = (a: MigrationFinding, b: MigrationFinding): number => {
	if (a.file !== b.file) return a.file < b.file ? -1 : 1;
	if (a.range !== undefined || b.range !== undefined) {
		if (a.range === undefined) return -1;
		if (b.range === undefined) return 1;
		if (a.range.offset !== b.range.offset) return a.range.offset - b.range.offset;
	}
	return a.code === b.code ? 0 : a.code < b.code ? -1 : 1;
};

/**
 * Pure. Everything in `bundle` that reads differently under OKF `target` (OKF 0.3 §6.2, §8.1, §10.3, §12.1), with
 * ranges, ordered by file, then range, then code. The version is reported as undeclared, older or unparsable; a
 * reference is `root-relative-path` when it lands only through the v0.2 root fallback (whatever the bundle
 * declares), so a value that misses under both rules is not reported; the Computation locator is reported only
 * while the bundle still reads with the legacy locator, since raising the version would change nothing else.
 *
 * @public
 */
export const migrationFindings = (
	bundle: LoadedBundle,
	config: OkfitConfig,
	target: string,
): ReadonlyArray<MigrationFinding> => {
	const legacy = OkfVersion.legacyFallbacks(bundle);
	const computations = legacy
		? [...bundle.concepts.values()].flatMap((concept) => computationFinding(concept, target) ?? [])
		: [];
	return [
		...versionFindings(bundle, target),
		...rootRelativeFindings(bundle, config, target),
		...computations,
	].toSorted(compare);
};
