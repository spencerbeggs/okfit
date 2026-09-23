import { DateTime } from "effect";
import { Actor } from "../Actor.js";
import type { LoadedBundle, LoadedConcept } from "../Bundle.js";
import { Derive } from "../Derive.js";
import type { DiagnosticSeverity, LintCode } from "../Diagnostic.js";
import { Diagnostic, DiagnosticRange } from "../Diagnostic.js";
import type { LinkGraph } from "../Graph.js";
import type { OkfitConfig } from "../OkfitConfig.js";
import { frontmatterPathRange } from "./frontmatter.js";

/** Everything one lint rule may read; built once per `Validate.lint` call. */
export interface LintContext {
	readonly bundle: LoadedBundle;
	readonly config: OkfitConfig;
	readonly graph: LinkGraph;
	readonly now: DateTime.Utc | undefined;
	readonly severity: (code: LintCode) => DiagnosticSeverity | "off";
}

/** One function per lint code (D-34). */
export type LintRule = (context: LintContext) => ReadonlyArray<Diagnostic>;

const FOOTNOTE_RE = /\[\^([^\]\s]+)\]/g;
/** A footnote definition: the label at a line start, followed by a colon. */
const FOOTNOTE_DEFINITION_RE = /^\[\^([^\]\s]+)\]:/gm;

const present = (raw: Record<string, unknown>, key: string): boolean => Object.hasOwn(raw, key) && raw[key] !== null;

/**
 * Source spans of every inline code span and code block, so a footnote-shaped
 * token inside backticks is read as literal text (issue #67).
 */
const codeSpansOf = (concept: LoadedConcept): ReadonlyArray<readonly [number, number]> =>
	concept.document
		.findAll((node) => node.type === "inlineCode" || node.type === "code")
		.map((node) => [node.position.start.offset, node.position.end.offset] as const);

const insideAny = (spans: ReadonlyArray<readonly [number, number]>, offset: number): boolean =>
	spans.some(([start, end]) => offset >= start && offset < end);

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

export const unknownType: LintRule = perConcept("unknown-type", (concept, context) =>
	Object.hasOwn(context.config.types ?? {}, concept.frontmatter.type)
		? []
		: [{ message: `Type "${concept.frontmatter.type}" is not declared in [types]`, path: ["type"] }],
);

export const requiredKeyMissing: LintRule = perConcept("required-key-missing", (concept, context) => {
	const declared = context.config.types?.[concept.frontmatter.type]?.required ?? [];
	const keys = [...new Set([...(context.config.concepts?.required ?? []), ...declared])];
	return keys.filter((key) => !present(concept.frontmatter.raw, key)).map((key) => `Required key "${key}" is missing`);
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
		? [{ message: `Type "${concept.frontmatter.type}" requires a verified entry`, path: ["status"] }]
		: [],
);

// Issue #110: `Derive.status` reads an absent `status` as `stable`, so a freshly
// generated, never-verified concept looked settled to every consumer.
export const statusMissing: LintRule = perConcept("status-missing", (concept) =>
	concept.frontmatter.status === undefined && (concept.frontmatter.verified ?? []).length === 0
		? ["Concept has no status and no verified entry, so it reads as stable; set status: draft or stable explicitly"]
		: [],
);

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

export const actorPrefixUnknown: LintRule = perConcept("actor-prefix-unknown", (concept) => {
	const candidates: ReadonlyArray<{ readonly by: Actor | undefined; readonly path: ReadonlyArray<string | number> }> = [
		{ by: concept.frontmatter.generated?.by, path: ["generated", "by"] },
		...(concept.frontmatter.verified ?? []).map((entry, index) => ({
			by: entry.by,
			path: ["verified", index, "by"] as ReadonlyArray<string | number>,
		})),
	];
	const out: Array<RangedMessage> = [];
	for (const candidate of candidates) {
		if (candidate.by === undefined || Actor.form(candidate.by) !== "other") continue;
		out.push({
			message: `Actor "${candidate.by}" uses an unknown prefix; expected human:<id>, process:<id>, or <producer>/<version>`,
			path: candidate.path,
		});
	}
	return out;
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

export const footnoteSourceUnknown: LintRule = rule("footnote-source-unknown", (context, severity) => {
	const out: Array<Diagnostic> = [];
	for (const concept of context.bundle.concepts.values()) {
		const ids = new Set((concept.frontmatter.sources ?? []).flatMap((s) => (s.id === undefined ? [] : [s.id])));
		if (ids.size === 0) {
			continue;
		}
		const source = concept.document.source;
		const start = concept.document.frontmatter?.position.end.offset ?? 0;
		const code = codeSpansOf(concept);
		const seen = new Set<string>();
		for (const match of source.slice(start).matchAll(FOOTNOTE_RE)) {
			const label = match[1];
			if (label === undefined || ids.has(label) || seen.has(label) || insideAny(code, start + match.index)) {
				continue;
			}
			seen.add(label);
			const range = DiagnosticRange.fromOffset(source, start + match.index, match[0].length);
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
		const start = concept.document.frontmatter?.position.end.offset ?? 0;
		const body = source.slice(start);
		const code = codeSpansOf(concept);
		const defined = new Set(
			[...body.matchAll(FOOTNOTE_DEFINITION_RE)].flatMap((m) =>
				m[1] === undefined || insideAny(code, start + m.index) ? [] : [m[1]],
			),
		);
		const seen = new Set<string>();
		for (const match of body.matchAll(FOOTNOTE_RE)) {
			const label = match[1];
			if (label === undefined || defined.has(label) || seen.has(label) || insideAny(code, start + match.index)) {
				continue;
			}
			seen.add(label);
			const range = DiagnosticRange.fromOffset(source, start + match.index, match[0].length);
			out.push(
				diagnostic(
					concept.path,
					"footnote-undefined",
					severity,
					`Footnote "${label}" is referenced but has no [^${label}]: definition`,
					range,
				),
			);
		}
	}
	return out;
});

/** GitHub-style heading slug: lowercase, punctuation dropped, spaces to hyphens, duplicates suffixed `-1`, `-2`, ... */
const headingSlugs = (concept: LoadedConcept): ReadonlySet<string> => {
	const seen = new Map<string, number>();
	const slugs = new Set<string>();
	for (const heading of concept.document.headings) {
		const base = heading.text
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s-]/gu, "")
			.trim()
			.replace(/\s+/g, "-");
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		slugs.add(count === 0 ? base : `${base}-${count}`);
	}
	return slugs;
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
	const slugCache = new Map<string, ReadonlySet<string>>();
	const anchors: Array<Diagnostic> = [];
	const slugsOf = (id: string, target: LoadedConcept): ReadonlySet<string> => {
		const cached = slugCache.get(id);
		if (cached !== undefined) return cached;
		const slugs = headingSlugs(target);
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
		if (fragment === undefined || fragment === "" || slugsOf(targetId, target).has(fragment)) return;
		const message = `Link target "${raw}" exists but has no heading "#${fragment}"`;
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

export const missingIndex: LintRule = rule("missing-index", (context, severity) =>
	context.bundle.directories
		.filter((dir) => !context.bundle.indexes.has(dir))
		.map((dir) => {
			const message = `Directory "${dir === "" ? "." : dir}" has no index.md`;
			return diagnostic(dir === "" ? "index.md" : `${dir}/index.md`, "missing-index", severity, message, undefined);
		}),
);

/** Fixed rule order (task-group decision 9). */
export const LINT_RULES: ReadonlyArray<LintRule> = [
	configUnknownKey,
	unknownType,
	requiredKeyMissing,
	fieldValueUnknown,
	requireVerifiedUnmet,
	statusMissing,
	generatedMissing,
	actorPrefixUnknown,
	footnoteSourceUnknown,
	footnoteUndefined,
	brokenLinks,
	missingIndex,
	stale,
];
