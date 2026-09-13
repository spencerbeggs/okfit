import { DateTime } from "effect";
import { Actor } from "../Actor.js";
import type { LoadedBundle, LoadedConcept } from "../Bundle.js";
import { Derive } from "../Derive.js";
import type { DiagnosticSeverity, LintCode } from "../Diagnostic.js";
import { Diagnostic, DiagnosticRange } from "../Diagnostic.js";
import type { LinkGraph } from "../Graph.js";
import type { OkfitConfig } from "../OkfitConfig.js";

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

const frontmatterRange = (concept: LoadedConcept): DiagnosticRange | undefined => {
	const node = concept.document.frontmatter;
	if (node === undefined) {
		return undefined;
	}
	const start = node.position.start.offset;
	return DiagnosticRange.fromOffset(concept.document.source, start, node.position.end.offset - start);
};

const present = (raw: Record<string, unknown>, key: string): boolean => Object.hasOwn(raw, key) && raw[key] !== null;

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

/** A rule that yields messages per concept, each carrying the frontmatter block range (decision 2). */
const perConcept = (
	code: LintCode,
	body: (concept: LoadedConcept, context: LintContext) => ReadonlyArray<string>,
): LintRule =>
	rule(code, (context, severity) =>
		[...context.bundle.concepts.values()].flatMap((concept) =>
			body(concept, context).map((message) =>
				diagnostic(concept.path, code, severity, message, frontmatterRange(concept)),
			),
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
		: [`Type "${concept.frontmatter.type}" is not declared in [types]`],
);

export const requiredKeyMissing: LintRule = perConcept("required-key-missing", (concept, context) => {
	const declared = context.config.types?.[concept.frontmatter.type]?.required ?? [];
	const keys = [...new Set([...(context.config.concepts?.required ?? []), ...declared])];
	return keys.filter((key) => !present(concept.frontmatter.raw, key)).map((key) => `Required key "${key}" is missing`);
});

export const fieldValueUnknown: LintRule = perConcept("field-value-unknown", (concept, context) => {
	const fields = context.config.types?.[concept.frontmatter.type]?.fields ?? {};
	const out: Array<string> = [];
	for (const [key, declaration] of Object.entries(fields)) {
		if (declaration.values === undefined || !present(concept.frontmatter.raw, key)) {
			continue;
		}
		const value = concept.frontmatter.raw[key];
		if (typeof value !== "string" || !Object.hasOwn(declaration.values, value)) {
			out.push(
				`Value ${JSON.stringify(value)} for "${key}" is not one of: ${Object.keys(declaration.values).join(", ")}`,
			);
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
		? [`Type "${concept.frontmatter.type}" requires a verified entry`]
		: [],
);

export const actorPrefixUnknown: LintRule = perConcept("actor-prefix-unknown", (concept) => {
	const actors = [concept.frontmatter.generated?.by, ...(concept.frontmatter.verified ?? []).map((v) => v.by)];
	return actors
		.filter((by): by is Actor => by !== undefined && Actor.form(by) === "other")
		.map((by) => `Actor "${by}" uses an unknown prefix; expected human:<id>, process:<id>, or <producer>/<version>`);
});

export const stale: LintRule = perConcept("stale", (concept, context) =>
	context.now !== undefined &&
	concept.frontmatter.stale_after !== undefined &&
	Derive.isStale(concept.frontmatter, context.now)
		? [`Concept is stale since ${DateTime.formatIso(concept.frontmatter.stale_after)}`]
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
		const seen = new Set<string>();
		for (const match of source.slice(start).matchAll(FOOTNOTE_RE)) {
			const label = match[1];
			if (label === undefined || ids.has(label) || seen.has(label)) {
				continue;
			}
			seen.add(label);
			const range = DiagnosticRange.fromOffset(source, start + match.index, match[0].length);
			out.push(
				diagnostic(
					concept.path,
					"footnote-source-unknown",
					severity,
					`Footnote label "${label}" matches no sources[].id`,
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
		const defined = new Set(
			[...body.matchAll(FOOTNOTE_DEFINITION_RE)].flatMap((m) => (m[1] === undefined ? [] : [m[1]])),
		);
		const seen = new Set<string>();
		for (const match of body.matchAll(FOOTNOTE_RE)) {
			const label = match[1];
			if (label === undefined || defined.has(label) || seen.has(label)) {
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

export const brokenLinks: LintRule = rule("broken-links", (context, severity) => {
	const pathOf = new Map([...context.bundle.concepts.values()].map((concept) => [concept.id as string, concept.path]));
	return context.graph.dangling().map((link) => {
		const message = `Link target "${link.data.raw}" does not exist in the bundle`;
		return diagnostic(pathOf.get(link.from) ?? link.from, "broken-links", severity, message, link.data.position);
	});
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
	actorPrefixUnknown,
	footnoteSourceUnknown,
	footnoteUndefined,
	brokenLinks,
	missingIndex,
	stale,
];
