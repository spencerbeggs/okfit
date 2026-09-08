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
 * The `"off"` severity is read here (to stamp the resolved value on every
 * diagnostic this DOES emit) but never gates the walk itself (Judge note
 * 3) -- `validate/run.ts` (the CLI) is the only caller, and it never
 * invokes this function at all when the resolved severity is `"off"`, so
 * the cost-avoidance property lives in exactly one place.
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
		const path = yield* Path.Path;
		// Contract §3.2 step 1: read here, not only for the CLI's own "off"
		// gate -- this is the value stamped on every Diagnostic below. The cast
		// documents the invariant Judge note 3 leaves to the caller: this
		// function is never invoked with an "off" severity in practice, so the
		// `"off"` member of `severityFor`'s return type never actually reaches
		// `Diagnostic.make`.
		const severity = OkfitConfig.severityFor(config, "generated-at-drift") as Exclude<
			ReturnType<typeof OkfitConfig.severityFor>,
			"off"
		>;
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
