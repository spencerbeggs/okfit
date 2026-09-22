import type { RenderedDiagnostic } from "../render/sort.js";

/**
 * Diagnostics keyed by bundle-relative posix file (`""` for bundle-level);
 * every stored list is non-empty.
 *
 * @public
 */
export type DiagnosticsByFile = ReadonlyMap<string, ReadonlyArray<RenderedDiagnostic>>;

/**
 * Group `diagnostics` by `file`, keeping input order within each file.
 *
 * @public
 */
export const groupByFile = (diagnostics: ReadonlyArray<RenderedDiagnostic>): DiagnosticsByFile => {
	const grouped = new Map<string, Array<RenderedDiagnostic>>();
	for (const diagnostic of diagnostics) {
		const list = grouped.get(diagnostic.file);
		if (list === undefined) grouped.set(diagnostic.file, [diagnostic]);
		else list.push(diagnostic);
	}
	return grouped;
};

const fingerprint = (list: ReadonlyArray<RenderedDiagnostic>): string =>
	list
		.map((d) =>
			JSON.stringify([d.source, d.code, d.severity, d.message, d.range?.offset ?? null, d.range?.length ?? null]),
		)
		.join("\n");

/**
 * The files whose diagnostic list differs between `previous` and `next`,
 * structurally and in order, mapped to their `next` list; a file present only in
 * `previous` maps to `[]` (its set became empty).
 *
 * @public
 */
export const diffDiagnostics = (
	previous: DiagnosticsByFile,
	next: DiagnosticsByFile,
): Map<string, ReadonlyArray<RenderedDiagnostic>> => {
	const changed = new Map<string, ReadonlyArray<RenderedDiagnostic>>();
	for (const [file, list] of next) {
		if (fingerprint(previous.get(file) ?? []) !== fingerprint(list)) changed.set(file, list);
	}
	for (const file of previous.keys()) {
		if (!next.has(file)) changed.set(file, []);
	}
	return changed;
};
