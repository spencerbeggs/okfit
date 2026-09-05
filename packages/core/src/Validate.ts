import type { DateTime } from "effect";
import { Schema } from "effect";
import type { LoadedBundle } from "./Bundle.js";
import { Diagnostic, LintCode } from "./Diagnostic.js";
import { Graph } from "./Graph.js";
import type { LintContext } from "./internal/lintRules.js";
import { LINT_RULES } from "./internal/lintRules.js";
import { OkfitConfig } from "./OkfitConfig.js";

/** Options for {@link Validate.lint}; `stale` fires only when `now` is supplied (D-34). @public */
export interface ValidateOptions {
	readonly now?: DateTime.Utc;
}

/** Both tiers. Non-empty `conformance` means CLI exit 2; any `error` in `lint` means exit 1 (spec 3.4). @public */
export interface ValidationReport {
	readonly conformance: ReadonlyArray<Diagnostic>;
	readonly lint: ReadonlyArray<Diagnostic>;
}

const isLintCode = Schema.is(LintCode);

/** Conformance and lint tiers over a {@link LoadedBundle}; pure (D-35). @public */
export class Validate {
	private constructor() {}

	/** The conformance-coded entries of `bundle.diagnostics`; always severity `error` (D-33). */
	static readonly conformance = (bundle: LoadedBundle): ReadonlyArray<Diagnostic> =>
		bundle.diagnostics.filter(Diagnostic.isConformance);

	/** Load-time lint diagnostics re-severitied via {@link OkfitConfig.severityFor} (`off` drops), then every rule (D-34). */
	static readonly lint = (
		bundle: LoadedBundle,
		config: OkfitConfig,
		options: ValidateOptions = {},
	): ReadonlyArray<Diagnostic> => {
		const severity = (code: LintCode) => OkfitConfig.severityFor(config, code);
		const loadTime: Array<Diagnostic> = [];
		for (const entry of bundle.diagnostics) {
			if (!isLintCode(entry.code)) {
				continue;
			}
			const resolved = severity(entry.code);
			if (resolved === "off") {
				continue;
			}
			loadTime.push(resolved === entry.severity ? entry : Diagnostic.make({ ...entry, severity: resolved }));
		}
		const context: LintContext = { bundle, config, graph: Graph.fromBundle(bundle), now: options.now, severity };
		return [...loadTime, ...LINT_RULES.flatMap((rule) => rule(context))];
	};

	/** Runs both tiers (D-35). */
	static readonly all = (bundle: LoadedBundle, config: OkfitConfig, options?: ValidateOptions): ValidationReport => ({
		conformance: Validate.conformance(bundle),
		lint: Validate.lint(bundle, config, options),
	});
}
