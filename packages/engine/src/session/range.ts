import type { LoadedBundle } from "@okfit/core";
import { ConceptId, DiagnosticRange } from "@okfit/core";
import { Option } from "effect";
import type { RenderedDiagnostic } from "../render/sort.js";

const FILE_START = DiagnosticRange.make({ offset: 0, length: 0, line: 0, character: 0 });

/**
 * Give a range-less diagnostic somewhere to point (spec 4.3): the concept's
 * frontmatter block when the file loaded as a concept with frontmatter, else a
 * zero-length range at line 0. Ranged and bundle-level (`file === ""`)
 * diagnostics are returned unchanged. A file whose frontmatter failed to decode
 * is not a loaded concept and falls to line 0; core ranges its own decode
 * diagnostics already.
 *
 * @public
 */
export const withFallbackRange = (bundle: LoadedBundle, diagnostic: RenderedDiagnostic): RenderedDiagnostic => {
	if (diagnostic.range !== undefined || diagnostic.file === "") return diagnostic;
	const concept = Option.match(ConceptId.fromPath(diagnostic.file), {
		onNone: () => undefined,
		onSome: (id) => bundle.concepts.get(id),
	});
	const node = concept?.document.frontmatter;
	if (concept === undefined || node === undefined) return { ...diagnostic, range: FILE_START };
	return {
		...diagnostic,
		range: DiagnosticRange.fromOffset(
			concept.document.source,
			node.position.start.offset,
			node.position.end.offset - node.position.start.offset,
		),
	};
};
