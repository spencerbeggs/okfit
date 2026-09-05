import type { RenderedDiagnostic } from "./sort.js";

/** @public */
export interface Tally {
	readonly conformanceErrors: number;
	readonly lintErrors: number;
	readonly lintWarnings: number;
	readonly lintInfo: number;
	readonly profileErrors: number;
}

/**
 * One pass over the collected diagnostics. `core.conformance` entries are
 * always severity `error` (D-33); the counts are still taken from `severity`
 * so a future non-error conformance code cannot silently change the exit
 * code.
 *
 * @public
 */
export const tally = (diagnostics: ReadonlyArray<RenderedDiagnostic>): Tally => {
	let conformanceErrors = 0;
	let lintErrors = 0;
	let lintWarnings = 0;
	let lintInfo = 0;
	let profileErrors = 0;
	for (const d of diagnostics) {
		if (d.source === "core.conformance") {
			if (d.severity === "error") conformanceErrors++;
			continue;
		}
		if (d.source === "core.lint") {
			if (d.severity === "error") lintErrors++;
			else if (d.severity === "warning") lintWarnings++;
			else lintInfo++;
			continue;
		}
		// d.source === "profile": always severity error (P-21); still gated on severity per the docstring above.
		if (d.severity === "error") profileErrors++;
	}
	return { conformanceErrors, lintErrors, lintWarnings, lintInfo, profileErrors };
};

/**
 * K-7/K-8's two lowest tiers: `2` when any conformance error is present, else
 * `1` when any lint OR profile error is present, else `0`. Warnings and info
 * never move it. `130`, `64` and `3` are set elsewhere — by the runtime's
 * interrupt branch, by the `ShowHelp` remap in `bin.ts`, and by the typed
 * errors' own `[Runtime.errorExitCode]` — so this function returns only
 * `0 | 1 | 2`.
 *
 * @public
 */
export const forDiagnostics = (diagnostics: ReadonlyArray<RenderedDiagnostic>): 0 | 1 | 2 => {
	const t = tally(diagnostics);
	return t.conformanceErrors > 0 ? 2 : t.lintErrors + t.profileErrors > 0 ? 1 : 0;
};
