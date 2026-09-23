import type { Frontmatter, MarkdownDocument } from "@effected/markdown";
import { Option } from "effect";
import type { Concept } from "../Concept.js";
import type { DiagnosticSeverity } from "../Diagnostic.js";
import { Diagnostic, DiagnosticRange } from "../Diagnostic.js";
import type { FamilyIssue } from "./conceptDecode.js";
import { decodeConcept as decodeEnvelope } from "./conceptDecode.js";
import { frontmatterPathSpan } from "./yamlPathSpan.js";

/** D-34 default severities for a `FamilyIssue`'s lint code; `type-missing` (D-33) is always "error". */
const FAMILY_ISSUE_SEVERITY: Record<FamilyIssue["code"], DiagnosticSeverity> = {
	"family-invalid": "error",
	"legacy-timestamp": "info",
	"computation-runtime-missing": "error",
};

interface Context {
	readonly file: string;
	readonly text: string;
	readonly node: Frontmatter;
}

const spanToRange = (text: string, path: ReadonlyArray<string | number>, node: Frontmatter): DiagnosticRange => {
	const span = frontmatterPathSpan(text, node, path);
	return DiagnosticRange.fromOffset(text, span.offset, span.length);
};

/**
 * Maps a frontmatter YAML path to a precise range inside `document.source` (decision 2 of the
 * phase 4 plan): the whole frontmatter block for `path: []`, `undefined` only when the document
 * has no frontmatter block at all, and the block again as a fallback when the leaf named by
 * `path` cannot be found (an absent key, or a fatal re-parse that should not happen once the
 * document already decoded once upstream). For a double-quoted scalar value, the returned range
 * includes the delimiting quote characters, since the yaml kit reports a quoted scalar's offset
 * and length inclusive of them.
 *
 * @internal
 */
export const frontmatterPathRange = (
	document: MarkdownDocument,
	path: ReadonlyArray<string | number>,
): DiagnosticRange | undefined =>
	document.frontmatter === undefined ? undefined : spanToRange(document.source, path, document.frontmatter);

const rangeFor = (context: Context, path: ReadonlyArray<string | number>): DiagnosticRange =>
	spanToRange(context.text, path, context.node);

const toDiagnostic = (context: Context, issue: FamilyIssue): Diagnostic =>
	Diagnostic.make({
		file: context.file,
		code: issue.code,
		severity: FAMILY_ISSUE_SEVERITY[issue.code],
		message: issue.message,
		range: rangeFor(context, issue.path),
	});

/**
 * Group C's seam onto group B's two-stage decoder (decision 2): adapts B3's
 * `decodeConcept(value): ConceptDecodeResult` into the `Option<Concept>` / `Diagnostic[]`
 * shape `Bundle.ts` consumes. Never fails; a `TypeMissing` envelope reports `type-missing`
 * with no concept and no range.
 *
 * @public
 */
export const decodeConcept = (
	raw: unknown,
	context: Context,
): { readonly concept: Option.Option<Concept>; readonly diagnostics: ReadonlyArray<Diagnostic> } => {
	const result = decodeEnvelope(raw);
	if (result._tag === "TypeMissing") {
		return {
			concept: Option.none(),
			diagnostics: [
				Diagnostic.make({ file: context.file, code: "type-missing", severity: "error", message: result.message }),
			],
		};
	}
	return {
		concept: Option.some(result.concept),
		diagnostics: result.issues.map((issue) => toDiagnostic(context, issue)),
	};
};
