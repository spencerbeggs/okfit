import type { Git, GitCommandError, UnknownRefError } from "@effected/git";
import type { LoadedBundle } from "@okfit/core";
import { Diagnostic, OkfitConfig, Timestamp } from "@okfit/core";
import type { FileSystem, PlatformError } from "effect";
import { DateTime, Effect, Path, Schema } from "effect";
import { Derivation } from "./Derivation.js";
import type { GitHistory, GitHistoryError } from "./GitHistory.js";

const encodeAt = Schema.encodeSync(Timestamp);

/**
 * A profiles-owned lint over committed provenance (S-8). NOT a `Profile`
 * member and NOT a `ProfileDiagnostic` -- it returns core `Diagnostic`s with
 * code `"generated-at-drift"`, a real `LintCode` member, so `severityFor`,
 * the `[lint]` table, the renderers, the hook, and the MCP tool treat it
 * like every other lint (S-7). `Profile.check` and `ProfileDiagnosticCode`
 * are unchanged.
 *
 * Runs `Derivation.generatedAt` per concept, skips uncommitted bodies and
 * concepts without a `generated` block, and returns `[]` the moment a
 * `NotARepositoryError` surfaces: a bundle outside git has nothing to
 * derive for any concept, so the first occurrence short-circuits the whole
 * walk, not just the concept that triggered it (S-8). Emits no `range`
 * (S-12, Judge note 7): `Diagnostic.range` is `Schema.optionalKey` and is
 * simply omitted.
 *
 * `Provenance.lint` is total over severity (S-28, amending Judge note 3):
 * when `OkfitConfig.severityFor(config, "generated-at-drift")` resolves to
 * `"off"`, it returns `[]` before any per-concept work and before any git
 * call, so it is safe to call at any severity and never needs to cast
 * `"off"` away. `validate/run.ts` (the CLI) still gates on `"off"` before
 * calling at all; the two agree by construction (both skip the walk).
 *
 * @public
 */
export class Provenance {
	private constructor() {}

	static readonly lint: (
		bundle: LoadedBundle,
		config: OkfitConfig,
	) => Effect.Effect<
		ReadonlyArray<Diagnostic>,
		GitHistoryError | GitCommandError | UnknownRefError | PlatformError.PlatformError,
		Git | GitHistory | FileSystem.FileSystem | Path.Path
	> = Effect.fn("Provenance.lint")(function* (bundle: LoadedBundle, config: OkfitConfig) {
		// S-28: total over severity -- off returns [] before any git call, so
		// `severity` below is never "off" and needs no cast.
		const severity = OkfitConfig.severityFor(config, "generated-at-drift");
		if (severity === "off") return [];
		const path = yield* Path.Path;
		const diagnostics: Array<Diagnostic> = [];
		for (const [, concept] of bundle.concepts) {
			if (concept.frontmatter.generated === undefined) continue;
			const file = path.join(bundle.root, concept.path);
			const derived = yield* Derivation.generatedAt({ file }).pipe(
				Effect.catchTag("NotARepositoryError", () => Effect.succeed(undefined)),
			);
			// S-8: a bundle outside git has nothing to derive for ANY concept --
			// the first NotARepositoryError short-circuits the whole function.
			if (derived === undefined) return [];
			if (derived._tag === "uncommitted") continue;
			const recorded = concept.frontmatter.generated.at;
			const matches = recorded !== undefined && DateTime.Equivalence(recorded, derived.at);
			if (matches) continue;
			diagnostics.push(
				Diagnostic.make({
					file: concept.path,
					code: "generated-at-drift",
					severity,
					message: `generated.at is ${
						recorded === undefined ? "missing" : "recorded"
					}; the last body change was ${encodeAt(derived.at)} (${derived.sha.slice(0, 7)})`,
				}),
			);
		}
		return diagnostics;
	});
}
