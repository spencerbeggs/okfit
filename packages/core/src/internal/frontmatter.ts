import type { Frontmatter, MarkdownDocument } from "@effected/markdown";
import type { YamlPath } from "@effected/yaml";
import { YamlDocument } from "@effected/yaml";
import { Effect, Option, Result } from "effect";
import type { Concept } from "../Concept.js";
import type { DiagnosticSeverity } from "../Diagnostic.js";
import { Diagnostic, DiagnosticRange } from "../Diagnostic.js";
import type { FamilyIssue } from "./conceptDecode.js";
import { decodeConcept as decodeEnvelope } from "./conceptDecode.js";
import { toFileOffset } from "./position.js";

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

const blockRange = (text: string, node: Frontmatter): DiagnosticRange =>
	DiagnosticRange.fromOffset(text, node.position.start.offset, node.position.end.offset - node.position.start.offset);

/**
 * Lazily parses `node.value` as YAML only when `path` needs a range (D-14, D-15;
 * diagnostic-range-and-position-mapping.md section 5). Falls back to the whole frontmatter block
 * when `path` is `[]`, the leaf can't be found, or the YAML re-parse itself is fatal (it already
 * decoded once upstream, so a fatal re-parse should not happen; this is defense only).
 */
const pathRange = (text: string, node: Frontmatter, path: ReadonlyArray<string | number>): DiagnosticRange => {
	if (path.length === 0) return blockRange(text, node);
	const parsed = Effect.runSync(Effect.result(YamlDocument.parse(node.value)));
	if (Result.isFailure(parsed) || parsed.success.contents === null) return blockRange(text, node);
	const hit = parsed.success.contents.find(path as YamlPath);
	if (Option.isNone(hit)) return blockRange(text, node);
	return DiagnosticRange.fromOffset(text, toFileOffset(text, hit.value.offset), hit.value.length);
};

/**
 * Maps a frontmatter YAML path to a precise range inside `document.source` (decision 2 of the
 * phase 4 plan): the whole frontmatter block for `path: []`, `undefined` only when the document
 * has no frontmatter block at all, and the block again as a fallback when the leaf named by
 * `path` cannot be found (an absent key, or a fatal re-parse that should not happen once the
 * document already decoded once upstream).
 *
 * @internal
 */
export const frontmatterPathRange = (
	document: MarkdownDocument,
	path: ReadonlyArray<string | number>,
): DiagnosticRange | undefined =>
	document.frontmatter === undefined ? undefined : pathRange(document.source, document.frontmatter, path);

const rangeFor = (context: Context, path: ReadonlyArray<string | number>): DiagnosticRange =>
	pathRange(context.text, context.node, path);

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
