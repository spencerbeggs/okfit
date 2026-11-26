import { GlobPattern } from "@effected/glob";
import { EditDistance } from "@effected/source";
import { DateTime, Option, Result, Schema } from "effect";
import { Actor } from "../Actor.js";
import type { LoadedBundle, LoadedConcept } from "../Bundle.js";
import { Concept } from "../Concept.js";
import { Derive } from "../Derive.js";
import type { DiagnosticSeverity, LintCode } from "../Diagnostic.js";
import { Diagnostic, DiagnosticRange } from "../Diagnostic.js";
import { generatedAtIsFuture, verificationBlockingRestamp } from "../GeneratedAtFuture.js";
import type { LinkGraph } from "../Graph.js";
import { Graph } from "../Graph.js";
import { INTEGRITY_KEY } from "../Integrity.js";
import type { OkfitConfig } from "../OkfitConfig.js";
import { OkfVersion } from "../OkfVersion.js";
import { Timestamp } from "../Timestamp.js";
import { isAbsent } from "./conceptDecode.js";
import { frontmatterPathRange } from "./frontmatter.js";
import { tierOf } from "./tier.js";

/** Everything one lint rule may read; built once per `Validate.lint` call. */
export interface LintContext {
	readonly bundle: LoadedBundle;
	readonly config: OkfitConfig;
	readonly graph: LinkGraph;
	readonly now: DateTime.Utc | undefined;
	/** A label for messages that name the config file; `undefined` when no file is known. */
	readonly configPath: string | undefined;
	readonly severity: (code: LintCode) => DiagnosticSeverity | "off";
}

/** One function per lint code (D-34). */
export type LintRule = (context: LintContext) => ReadonlyArray<Diagnostic>;

/** OKF 0.3 §11.2 rule 1: a key holding null, the empty string or the empty list is absent. */
const present = (raw: Record<string, unknown>, key: string): boolean => Object.hasOwn(raw, key) && !isAbsent(raw[key]);

const diagnostic = (
	file: string,
	code: LintCode,
	severity: DiagnosticSeverity,
	message: string,
	range: DiagnosticRange | undefined,
): Diagnostic => Diagnostic.make({ file, code, severity, message, ...(range === undefined ? {} : { range }) });

/** Resolves the rule's severity once; `[]` when the code is off. */
const rule =
	(code: LintCode, body: (context: LintContext, severity: DiagnosticSeverity) => ReadonlyArray<Diagnostic>): LintRule =>
	(context) => {
		const severity = context.severity(code);
		return severity === "off" ? [] : body(context, severity);
	};

/** One offending value's message, optionally paired with the frontmatter path that names it; a bare string anchors at the frontmatter block (decision 2: absent-key rules have nothing more precise to point at). */
interface RangedMessage {
	readonly message: string;
	readonly path: ReadonlyArray<string | number>;
}

/** A rule that yields messages per concept, each anchored at the frontmatter path that names the offending value (default `[]`, the frontmatter block) and falling back to that block when the path's leaf is absent (decision 2). */
const perConcept = (
	code: LintCode,
	body: (concept: LoadedConcept, context: LintContext) => ReadonlyArray<RangedMessage | string>,
): LintRule =>
	rule(code, (context, severity) =>
		[...context.bundle.concepts.values()].flatMap((concept) =>
			body(concept, context).map((item) => {
				const { message, path } = typeof item === "string" ? { message: item, path: [] } : item;
				return diagnostic(concept.path, code, severity, message, frontmatterPathRange(concept.document, path));
			}),
		),
	);

export const configUnknownKey: LintRule = rule("config-unknown-key", (context, severity) =>
	Object.keys(context.config.extensions).map((key) =>
		diagnostic("", "config-unknown-key", severity, `Unknown config key "${key}"`, undefined),
	),
);

/**
 * The config's `okf_version` only fills a root index that declares none; once the index declares a different
 * version the config value is stale. Both sides compare through `OkfVersion` when they parse, as raw strings otherwise.
 */
export const configOkfVersionStale: LintRule = rule("config-okf-version-stale", (context, severity) => {
	const configured = context.config.okf_version;
	const declared = OkfVersion.declared(context.bundle);
	if (configured === undefined || Option.isNone(declared)) return [];
	const same = Option.match(Option.all([OkfVersion.parse(configured), OkfVersion.parse(declared.value)]), {
		onNone: () => configured === declared.value,
		onSome: ([a, b]) => OkfVersion.compare(a, b) === 0,
	});
	if (same) return [];
	const where = context.configPath === undefined ? "in the config" : `in ${context.configPath}`;
	const head = `okf_version ${where} is "${configured}", but the bundle-root index.md declares "${declared.value}"`;
	const message = Option.isSome(OkfVersion.parse(declared.value))
		? `${head}; okfit reads the bundle as "${declared.value}" and uses the config value only for a root index that declares none. Set okf_version = "${declared.value}" ${where}, or remove it`
		: `${head}, which is not a <major>.<minor> version; correct the declaration in index.md, then set okf_version ${where} to the same value, or remove it`;
	return [diagnostic("", "config-okf-version-stale", severity, message, undefined)];
});

/**
 * #471: a `generated.at` later than now counts for no verification (OKF 0.3 §5.3) and `okfit verify` refuses it;
 * `okfit sync` re-stamps it once any change to its body is committed, except when a verification would then count
 * (`verificationBlockingRestamp`).
 */
export const generatedAtFuture: LintRule = perConcept("generated-at-future", (concept, context) => {
	const at = concept.frontmatter.generated?.at;
	const { now } = context;
	if (at === undefined || now === undefined || !generatedAtIsFuture(at, now)) return [];
	const head = `generated.at ${instant(at)} is more than 5 minutes later than now (${instant(now)}), so no verification can count yet (OKF 0.3 §5.3) and okfit verify refuses this concept`;
	const blocking = verificationBlockingRestamp(
		(concept.frontmatter.verified ?? []).map((entry) => entry.at),
		at,
		now,
	);
	return [
		{
			message: Option.isSome(blocking)
				? `${head}; okfit sync will not re-stamp it, because the verification dated ${instant(blocking.value)} would then count without a re-verification; a human must correct generated.at or that verification`
				: `${head}; commit any change to its body, then run okfit sync, which re-stamps it`,
			path: ["generated", "at"],
		},
	];
});

export const unknownType: LintRule = perConcept("unknown-type", (concept, context) =>
	Object.hasOwn(context.config.types ?? {}, concept.frontmatter.type)
		? []
		: [{ message: `Type "${concept.frontmatter.type}" is not declared in [types]`, path: ["type"] }],
);

export const requiredKeyMissing: LintRule = perConcept("required-key-missing", (concept, context) => {
	const declared = context.config.types?.[concept.frontmatter.type]?.required ?? [];
	const keys = [...new Set([...(context.config.concepts?.required ?? []), ...declared])];
	const raw = concept.frontmatter.raw;
	// Empty and missing share one code (R16); only the wording differs, and the range sits on the key when it is written.
	return keys
		.filter((key) => !present(raw, key))
		.map((key) => ({
			message: `Required key "${key}" is ${Object.hasOwn(raw, key) ? "empty" : "missing"}`,
			path: [key],
		}));
});

export const fieldValueUnknown: LintRule = perConcept("field-value-unknown", (concept, context) => {
	const fields = context.config.types?.[concept.frontmatter.type]?.fields ?? {};
	const out: Array<RangedMessage> = [];
	for (const [key, declaration] of Object.entries(fields)) {
		if (declaration.values === undefined || !present(concept.frontmatter.raw, key)) {
			continue;
		}
		const value = concept.frontmatter.raw[key];
		if (typeof value !== "string" || !Object.hasOwn(declaration.values, value)) {
			out.push({
				message: `Value ${JSON.stringify(value)} for "${key}" is not one of: ${Object.keys(declaration.values).join(", ")}`,
				path: [key],
			});
		}
	}
	return out;
});

// A draft is unsettled by definition, so it is exempt (issue #31): otherwise a
// freshly authored bundle can never validate clean before a human verifies it.
export const requireVerifiedUnmet: LintRule = perConcept("require-verified-unmet", (concept, context) =>
	context.config.types?.[concept.frontmatter.type]?.require_verified === true &&
	concept.frontmatter.status !== "draft" &&
	(concept.frontmatter.verified ?? []).length === 0
		? [
				{
					// An unknown status is not exempt, and `okfit verify` refuses it, so the message names the way out (#459).
					message:
						Derive.status(concept.frontmatter) === "unknown"
							? `Type "${concept.frontmatter.type}" requires a verified entry; status "${Derive.rawStatus(concept.frontmatter)}" is not draft, stable or deprecated, so set it first or verify with okfit verify --stable or --draft`
							: `Type "${concept.frontmatter.type}" requires a verified entry`,
					path: ["status"],
				},
			]
		: [],
);

const TIER_RANK = { unverified: 0, "machine-confirmed": 1, "human-reviewed": 2 } as const;

const instant = Schema.encodeSync(Timestamp);

// OKF 0.3 §5.3 "verified before the last change". Reports one defect once (R32): `require-verified-unmet` still
// means no entry at all. Fires only when the tier actually fell, naming the newest event that lost its weight.
// Draft, deprecated and unknown-status concepts are exempt, as for `verified-drift`: `okfit verify` skips them.
export const verifiedBeforeChange: LintRule = perConcept("verified-before-change", (concept) => {
	const frontmatter = concept.frontmatter;
	const generatedAt = frontmatter.generated?.at;
	const status = Derive.status(frontmatter);
	if (generatedAt === undefined || status === "draft" || status === "deprecated" || status === "unknown") return [];
	const events = frontmatter.verified ?? [];
	const all = tierOf(events);
	const current = Derive.trustTier(frontmatter);
	if (TIER_RANK[all] <= TIER_RANK[current]) return [];
	const lost = events
		.map((entry, index) => ({ entry, index }))
		.filter(({ entry }) => !Derive.isCurrent(frontmatter, entry.at));
	const newest = (items: typeof lost) =>
		items.reduce<(typeof lost)[number] | undefined>(
			(best, item) =>
				best === undefined || DateTime.toEpochMillis(item.entry.at) > DateTime.toEpochMillis(best.entry.at)
					? item
					: best,
			undefined,
		);
	const target =
		(all === "human-reviewed" ? newest(lost.filter(({ entry }) => Actor.isHuman(entry.by))) : undefined) ??
		newest(lost);
	if (target === undefined) return [];
	return [
		{
			message: `Verified by ${target.entry.by} at ${instant(target.entry.at)}, before the last change at ${instant(generatedAt)}; the trust tier is now ${current} (OKF 0.3 §5.3); re-run okfit verify`,
			path: Concept.entryPath(frontmatter, "verified", target.index),
		},
	];
});

// Issue #110: `Derive.status` reads an absent `status` as `stable`, so a freshly
// generated, never-verified concept looked settled to every consumer.
export const statusMissing: LintRule = perConcept("status-missing", (concept) =>
	concept.frontmatter.status === undefined &&
	Derive.rawStatus(concept.frontmatter) === undefined &&
	(concept.frontmatter.verified ?? []).length === 0
		? ["Concept has no status and no verified entry, so it reads as stable; set status: draft or stable explicitly"]
		: [],
);

/**
 * R45/R46: an okfit opinion layered on the load diagnostics `frontmatter-missing` and `type-missing`
 * (OKF 0.3 §3.2 allows such files). Silent when `[bundle] non_concepts` is absent; otherwise a typeless
 * file no glob matches is reported, ranged like its load diagnostic. The load diagnostics are unchanged.
 */
export const nonConceptUnlisted: LintRule = rule("non-concept-unlisted", (context, severity) => {
	const globs = context.config.bundle?.non_concepts;
	if (globs === undefined) return [];
	const why = (code: string) => (code === "frontmatter-missing" ? "no frontmatter" : "no type");
	// The config schema rejects an uncompilable glob at load, so the empty branch is unreachable for a decoded config.
	const patterns = globs.flatMap((glob) => {
		const compiled = GlobPattern.compileResult(glob);
		return Result.isSuccess(compiled) ? [compiled.success] : [];
	});
	return context.bundle.diagnostics
		.filter(
			(d) =>
				(d.code === "frontmatter-missing" || d.code === "type-missing") &&
				!patterns.some((pattern) => pattern.matches(d.file)),
		)
		.map((d) =>
			diagnostic(
				d.file,
				"non-concept-unlisted",
				severity,
				globs.length === 0
					? `${d.file} is not a concept (${why(d.code)}) and [bundle] non_concepts is empty, so it allows no non-concept file; add frontmatter with a type, move it out of the bundle, or add a glob that matches it to non_concepts`
					: `${d.file} is not a concept (${why(d.code)}) and matches no [bundle] non_concepts glob (${globs.join(", ")}); add frontmatter with a type, move it out of the bundle, or list it in non_concepts`,
				d.range,
			),
		);
});

// Issue #73: `okfit sync` can only complete a `generated:` block that exists
// (or, from this change on, create one from `actors.agent`). Surface the
// missing block at validate time, before the commit, instead of leaving it
// to sync's post-commit `skipped` list.
export const generatedMissing: LintRule = perConcept("generated-missing", (concept, context) =>
	context.config.actors?.agent !== undefined && !present(concept.frontmatter.raw, "generated")
		? [
				`Concept has no generated block; okfit sync will create it from actors.agent (${context.config.actors.agent}) once the body is committed, or set generated.by by hand`,
			]
		: [],
);

/**
 * OKF 0.3 §10.3: an Attested Computation with neither a `computation` key nor an inline computation is not
 * attestable. `computationBody` is already the bundle's declared reading (fenced block under 0.3, the depth-1
 * section under 0.2), so a missing or blank body is the one condition. `runtime` is not required here:
 * `computation-runtime-missing` reports that separately.
 */
export const computationMissing: LintRule = rule("computation-missing", (context, severity) =>
	[...context.bundle.concepts.values()].flatMap((concept) => {
		const attested = concept.frontmatter.attested;
		if (attested === undefined || attested.computation !== undefined) return [];
		const body = concept.computationBody;
		if (Option.isSome(body) && body.value.trim() !== "") return [];
		const heading = Option.orElse(concept.document.sectionByHeading("Computation", { depth: 1 }), () =>
			concept.document.sectionByHeading("Computation"),
		);
		const range = Option.match(heading, {
			onNone: () => frontmatterPathRange(concept.document, []),
			onSome: ({ heading: node }) =>
				DiagnosticRange.fromOffset(
					concept.document.source,
					node.position.start.offset,
					node.position.end.offset - node.position.start.offset,
				),
		});
		const legacy = OkfVersion.legacyFallbacks(context.bundle);
		// Under the 0.2 reading only a depth-1 Computation section counts, so a deeper-only heading is a different defect.
		const nestedOnly =
			legacy && Option.isSome(heading) && Option.isNone(concept.document.sectionByHeading("Computation", { depth: 1 }));
		const message = nestedOnly
			? "This Attested Computation has no computation: under OKF 0.2 the Computation section must be a top-level heading, and this one is not, so it is not attestable; make it a top-level heading, or declare okf_version 0.3 and put the computation in one fenced block"
			: Option.isSome(heading)
				? legacy
					? "This Attested Computation has no computation: its top-level Computation section is empty, so it is not attestable; write the computation under it, or set computation to a file"
					: // Under the 0.3 reading a present body is the first fence's code, and here it is blank.
						Option.isSome(body)
						? "This Attested Computation has no computation: the first fenced code block in its Computation section is empty (OKF 0.3 §10.3), so it is not attestable; put the computation in that block, or set computation to a file"
						: "This Attested Computation has no computation: its Computation section holds no fenced code block (OKF 0.3 §10.3), so it is not attestable; put the computation in one fenced block, or set computation to a file"
				: legacy
					? "This Attested Computation has no computation: it has no Computation section and no computation key, so it is not attestable; add a top-level Computation section that holds the computation, or set computation to a file"
					: "This Attested Computation has no computation: it has no Computation section and no computation key, so it is not attestable; add a Computation section with the computation in one fenced block, or set computation to a file";
		return [diagnostic(concept.path, "computation-missing", severity, message, range)];
	}),
);

export const actorPrefixUnknown: LintRule = perConcept("actor-prefix-unknown", (concept) => {
	const candidates: ReadonlyArray<{ readonly by: Actor | undefined; readonly path: ReadonlyArray<string | number> }> = [
		{ by: concept.frontmatter.generated?.by, path: ["generated", "by"] },
		...(concept.frontmatter.verified ?? []).map((entry, index) => ({
			by: entry.by,
			path: [...Concept.entryPath(concept.frontmatter, "verified", index), "by"] as ReadonlyArray<string | number>,
		})),
		...(concept.frontmatter.sources ?? []).map((entry, index) => ({
			by: entry.author,
			path: [...Concept.entryPath(concept.frontmatter, "sources", index), "author"] as ReadonlyArray<string | number>,
		})),
	];
	const out: Array<RangedMessage> = [];
	for (const candidate of candidates) {
		if (candidate.by === undefined || Actor.form(candidate.by) !== "other") continue;
		out.push({
			message: `Actor "${candidate.by}" uses an unknown prefix; expected human:<id>, team:<id>, process:<id>, or <producer>/<version>`,
			path: candidate.path,
		});
	}
	return out;
});

/** Every actor-valued frontmatter field of a concept, with the path that names it. */
const actorsOf = (
	concept: LoadedConcept,
): ReadonlyArray<{ readonly by: Actor; readonly path: ReadonlyArray<string | number> }> => {
	const verifiedPath = (index: number): ReadonlyArray<string | number> => [
		...Concept.entryPath(concept.frontmatter, "verified", index),
		"by",
	];
	const binding = concept.frontmatter.integrity?.verified;
	return [
		...(concept.frontmatter.generated === undefined
			? []
			: [{ by: concept.frontmatter.generated.by, path: ["generated", "by"] }]),
		...(concept.frontmatter.verified ?? []).map((entry, index) => ({ by: entry.by, path: verifiedPath(index) })),
		...(binding === undefined ? [] : [{ by: binding.by, path: [INTEGRITY_KEY, "verified", "by"] }]),
	];
};

const EMAIL_HINT = "okfit never stores email addresses; use a human:<id> without the domain";

export const actorEmail: LintRule = rule("actor-email", (context, severity) => [
	...(context.config.actors?.humans ?? [])
		.filter((entry) => entry.includes("@"))
		.map((entry) =>
			diagnostic("", "actor-email", severity, `actors.humans entry "${entry}" contains "@"; ${EMAIL_HINT}`, undefined),
		),
	...[...context.bundle.concepts.values()].flatMap((concept) =>
		actorsOf(concept)
			.filter((candidate) => candidate.by.includes("@"))
			.map((candidate) =>
				diagnostic(
					concept.path,
					"actor-email",
					severity,
					`Actor "${candidate.by}" contains "@"; ${EMAIL_HINT}`,
					frontmatterPathRange(concept.document, candidate.path),
				),
			),
	),
]);

export const verifiedActorUnknown: LintRule = perConcept("verified-actor-unknown", (concept, context) => {
	const humans = context.config.actors?.humans ?? [];
	if (humans.length === 0) return [];
	return actorsOf(concept)
		.filter((candidate) => candidate.path[0] !== "generated")
		.filter((candidate) => Actor.isHuman(candidate.by) && !Actor.allowed(candidate.by, humans))
		.map((candidate) => ({
			message: `Verifier "${candidate.by}" matches no entry of actors.humans; add it there, or have a listed human re-verify`,
			path: candidate.path,
		}));
});

export const stale: LintRule = perConcept("stale", (concept, context) =>
	context.now !== undefined &&
	concept.frontmatter.stale_after !== undefined &&
	Derive.isStale(concept.frontmatter, context.now)
		? [
				{
					message: `Concept is stale since ${DateTime.formatIso(concept.frontmatter.stale_after)}`,
					path: ["stale_after"],
				},
			]
		: [],
);

/**
 * Every footnote label a concept uses, once each in source order, with the offset of its first
 * `[^label]` marker: resolved references, definitions and the markers the parser rejected for want
 * of a definition. A marker in a code span or block, or an escaped one, is literal text and absent.
 */
const footnoteLabelsOf = (
	concept: LoadedConcept,
): ReadonlyArray<{ readonly label: string; readonly offset: number }> => {
	const markers = [
		...concept.document
			.findAll((node) => node.type === "footnoteReference" || node.type === "footnoteDefinition")
			.flatMap((node) =>
				node.type === "footnoteReference" || node.type === "footnoteDefinition"
					? [{ label: node.label ?? node.identifier, offset: node.position.start.offset }]
					: [],
			),
		...concept.document.unresolvedFootnoteReferences.map((marker) => ({
			label: marker.label,
			offset: marker.position.start.offset,
		})),
	].sort((left, right) => left.offset - right.offset);
	const seen = new Set<string>();
	const first: Array<{ readonly label: string; readonly offset: number }> = [];
	for (const marker of markers) {
		if (seen.has(marker.label)) {
			continue;
		}
		seen.add(marker.label);
		first.push(marker);
	}
	return first;
};

export const footnoteSourceUnknown: LintRule = rule("footnote-source-unknown", (context, severity) => {
	const out: Array<Diagnostic> = [];
	for (const concept of context.bundle.concepts.values()) {
		const ids = new Set((concept.frontmatter.sources ?? []).flatMap((s) => (s.id === undefined ? [] : [s.id])));
		if (ids.size === 0) {
			continue;
		}
		for (const { label, offset } of footnoteLabelsOf(concept)) {
			if (ids.has(label)) {
				continue;
			}
			const range = DiagnosticRange.fromOffset(concept.document.source, offset, label.length + 3);
			out.push(
				diagnostic(
					concept.path,
					"footnote-source-unknown",
					severity,
					`Footnote label "${label}" must equal a sources[].id exactly (declared: ${[...ids].join(", ")})`,
					range,
				),
			);
		}
	}
	return out;
});

// Markdownlint's MD052, so a bundle passes an ordinary repo's lint (issue #32):
// `footnote-source-unknown` checks a label against sources[].id and stops there,
// so a declared source referenced without a `[^id]: ...` line rendered as
// literal text and validated clean.
export const footnoteUndefined: LintRule = rule("footnote-undefined", (context, severity) => {
	const out: Array<Diagnostic> = [];
	for (const concept of context.bundle.concepts.values()) {
		const source = concept.document.source;
		const seen = new Set<string>();
		// The parser records each marker it rejects for want of a definition, so a marker in a code
		// span or code block never appears, and label matching follows GFM (case-insensitive).
		for (const marker of concept.document.unresolvedFootnoteReferences) {
			if (seen.has(marker.label)) {
				continue;
			}
			seen.add(marker.label);
			const { start, end } = marker.position;
			out.push(
				diagnostic(
					concept.path,
					"footnote-undefined",
					severity,
					`Footnote "${marker.label}" is referenced but has no [^${marker.label}]: definition`,
					DiagnosticRange.fromOffset(source, start.offset, end.offset - start.offset),
				),
			);
		}
	}
	return out;
});

/** The closest slug within max(2, ⌊|fragment| / 3⌋) edits, ties to the earliest heading; else undefined. */
const nearestSlug = (fragment: string, slugs: ReadonlyArray<string>): string | undefined =>
	EditDistance.suggest(fragment, slugs, { maxDistance: Math.max(2, Math.floor(fragment.length / 3)) })[0];

const candidateHint = (fragment: string, slugs: ReadonlyArray<string>): string => {
	if (slugs.length === 0) return "it has no headings";
	const near = nearestSlug(fragment, slugs);
	if (near !== undefined) return `did you mean "#${near}"?`;
	const shown = slugs
		.slice(0, 5)
		.map((slug) => `#${slug}`)
		.join(", ");
	return slugs.length > 5 ? `its headings: ${shown} (+${slugs.length - 5} more)` : `its headings: ${shown}`;
};

const fragmentOf = (raw: string): string | undefined => {
	const hash = raw.indexOf("#");
	if (hash < 0) return undefined;
	const fragment = raw.slice(hash + 1).split("?")[0] ?? "";
	try {
		return decodeURIComponent(fragment);
	} catch {
		return fragment;
	}
};

export const brokenLinks: LintRule = rule("broken-links", (context, severity) => {
	const byId = new Map([...context.bundle.concepts.values()].map((concept) => [concept.id as string, concept]));
	const fileOf = (from: string): string => byId.get(from)?.path ?? from;
	const dangling = context.graph.dangling().map((link) => {
		const message = `Link target "${link.data.raw}" does not exist in the bundle`;
		return diagnostic(fileOf(link.from), "broken-links", severity, message, link.data.position);
	});
	// Issue #69: a target file that exists but no longer carries the linked heading.
	const slugCache = new Map<string, ReadonlyArray<string>>();
	const anchors: Array<Diagnostic> = [];
	const slugsOf = (id: string, target: LoadedConcept): ReadonlyArray<string> => {
		const cached = slugCache.get(id);
		if (cached !== undefined) return cached;
		const slugs = target.document.headingSlugs;
		slugCache.set(id, slugs);
		return slugs;
	};
	const check = (
		file: string,
		raw: string,
		targetId: string,
		target: LoadedConcept,
		position: DiagnosticRange | undefined,
	): void => {
		const fragment = fragmentOf(raw);
		if (fragment === undefined || fragment === "") return;
		const slugs = slugsOf(targetId, target);
		if (slugs.includes(fragment)) return;
		const message = `Link target "${raw}" exists but has no heading "#${fragment}"; ${candidateHint(fragment, slugs)}`;
		anchors.push(diagnostic(file, "broken-links", severity, message, position));
	};
	for (const link of context.graph.edges) {
		if (link.data.source !== "body") continue;
		const target = byId.get(link.to);
		if (target === undefined) continue;
		check(fileOf(link.from), link.data.raw, link.to, target, link.data.position);
	}
	// A self-anchor (`[x](#heading)`) resolves to `self` and never becomes an edge (D-25), so read it off the document.
	for (const concept of context.bundle.concepts.values()) {
		for (const link of concept.document.links) {
			if (link.url === undefined || !link.url.startsWith("#") || link.node.type === "linkReference") continue;
			const { start, end } = link.node.position;
			const position = DiagnosticRange.fromOffset(concept.document.source, start.offset, end.offset - start.offset);
			check(concept.path, link.url, concept.id as string, concept, position);
		}
	}
	return [...dangling, ...anchors];
});

// OKF 0.3 5.4: `superseded_by` has a meaning only with `status: deprecated`. The derived status is read, so an
// out-of-vocabulary status (`unknown`) is not deprecated; an absent, empty or non-string value is never typed here.
export const supersededByOrphan: LintRule = perConcept("superseded-by-orphan", (concept) =>
	concept.frontmatter.superseded_by !== undefined && Derive.status(concept.frontmatter) !== "deprecated"
		? [
				{
					message: `superseded_by is set but status is not deprecated; it has a meaning only with status: deprecated`,
					path: ["superseded_by"],
				},
			]
		: [],
);

// OKF 0.3 5.4: a deprecated concept's replacement must be a concept. A missing target is `broken-links`' defect.
export const supersededByUnresolved: LintRule = perConcept("superseded-by-unresolved", (concept, context) => {
	const raw = concept.frontmatter.superseded_by;
	if (raw === undefined || Derive.status(concept.frontmatter) !== "deprecated") return [];
	const resolved = Graph.resolve(context.bundle, concept.path, raw, "superseded_by");
	const reason =
		resolved._tag === "node"
			? resolved.kind === "missing"
				? undefined
				: resolved.kind === "file"
					? "a file that is not a concept"
					: resolved.id === (concept.id as string)
						? "the concept itself"
						: undefined
			: resolved._tag === "self"
				? "the concept itself"
				: "an external value";
	return reason === undefined
		? []
		: [{ message: `superseded_by "${raw}" resolves to ${reason}, not a replacement concept`, path: ["superseded_by"] }];
});

export const missingIndex: LintRule = rule("missing-index", (context, severity) =>
	Derive.indexDirectories(context.bundle)
		.filter((dir) => !context.bundle.indexes.has(dir))
		.map((dir) => {
			const message = `Directory "${dir === "" ? "." : dir}" has no index.md`;
			return diagnostic(dir === "" ? "index.md" : `${dir}/index.md`, "missing-index", severity, message, undefined);
		}),
);

/** Fixed rule order (task-group decision 9). */
export const LINT_RULES: ReadonlyArray<LintRule> = [
	configUnknownKey,
	configOkfVersionStale,
	unknownType,
	requiredKeyMissing,
	fieldValueUnknown,
	requireVerifiedUnmet,
	verifiedBeforeChange,
	statusMissing,
	nonConceptUnlisted,
	generatedMissing,
	computationMissing,
	generatedAtFuture,
	actorPrefixUnknown,
	actorEmail,
	verifiedActorUnknown,
	footnoteSourceUnknown,
	footnoteUndefined,
	brokenLinks,
	supersededByOrphan,
	supersededByUnresolved,
	missingIndex,
	stale,
];
