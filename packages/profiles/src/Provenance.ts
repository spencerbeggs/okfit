import type { Git, GitCommandError, UnknownRefError } from "@effected/git";
import type { LoadedBundle } from "@okfit/core";
import { Diagnostic, OkfitConfig, Timestamp } from "@okfit/core";
import type { Crypto, FileSystem, PlatformError } from "effect";
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
 * Two tiers per concept (issue #19, body-digest design): when
 * `generated.body_sha256` is present, drift is decided ENTIRELY by comparing it to
 * `Derivation.bodyDigest` of the concept's current source -- no git call at
 * all, so this works for a dirty worktree too (that is the point: an edited
 * body is caught immediately, before it is even committed) and survives a
 * squash/rebase merge that only rewrites commit dates, since the body
 * itself, and therefore its digest, never changed. When `body_sha256` is
 * absent (an un-migrated concept), this falls back to the original
 * git-derived date comparison against `Derivation.generatedAt`, preserving
 * `--skip-provenance`'s meaning for bundles that have not run `okfit sync`
 * since this field was introduced.
 *
 * The tier-2 fallback returns `[]` the moment a `NotARepositoryError`
 * surfaces: a bundle outside git has nothing to derive for any concept still
 * on tier 2, so the first occurrence short-circuits the whole walk, not just
 * the concept that triggered it (S-8). Emits no `range` (S-12, Judge note
 * 7): `Diagnostic.range` is `Schema.optionalKey` and is simply omitted.
 *
 * `Provenance.lint` is total over severity (S-28, amending Judge note 3):
 * when `OkfitConfig.severityFor(config, "generated-at-drift")` resolves to
 * `"off"`, it returns `[]` before any per-concept work and before any git
 * call, so it is safe to call at any severity and never needs to cast
 * `"off"` away. `validate/run.ts` (the CLI) still gates on `"off"` before
 * calling at all; the two agree by construction (both skip the walk).
 *
 * A third, optional options argument carries `skipGitTier`: when `true`, a
 * concept that falls through to tier 2 (no `generated.body_sha256`
 * recorded) is skipped entirely -- no `Derivation.generatedAt` call, no
 * git spawn at all -- while tier 1 still runs, unaffected, for every
 * concept that DOES carry a digest. This is a runtime skip, not a
 * type-level narrowing: the R channel still lists `Git | GitHistory` even
 * when every call happens to skip them, since the type describes what the
 * function CAN require, not what one particular call ends up using.
 * Defaults to `false`, so every existing caller keeps its current
 * behavior unchanged.
 *
 * @public
 */
export class Provenance {
	private constructor() {}

	static readonly lint: (
		bundle: LoadedBundle,
		config: OkfitConfig,
		options?: { readonly skipGitTier?: boolean },
	) => Effect.Effect<
		ReadonlyArray<Diagnostic>,
		GitHistoryError | GitCommandError | UnknownRefError | PlatformError.PlatformError,
		Git | GitHistory | FileSystem.FileSystem | Path.Path | Crypto.Crypto
	> = Effect.fn("Provenance.lint")(function* (
		bundle: LoadedBundle,
		config: OkfitConfig,
		options?: { readonly skipGitTier?: boolean },
	) {
		// S-28: total over severity -- off returns [] before any git call, so
		// `severity` below is never "off" and needs no cast.
		const severity = OkfitConfig.severityFor(config, "generated-at-drift");
		if (severity === "off") return [];
		const skipGitTier = options?.skipGitTier === true;
		const path = yield* Path.Path;
		const diagnostics: Array<Diagnostic> = [];
		for (const [, concept] of bundle.concepts) {
			if (concept.frontmatter.generated === undefined) continue;
			const recordedDigest = concept.frontmatter.generated.body_sha256;

			// Tier 1: a digest was stamped -- compare it to the CURRENT body, never git. No
			// `derived.at`/date reasoning enters this branch at all.
			if (recordedDigest !== undefined) {
				const currentDigest = yield* Derivation.bodyDigest(concept.document.source);
				if (currentDigest === recordedDigest) continue;
				diagnostics.push(
					Diagnostic.make({
						file: concept.path,
						code: "generated-at-drift",
						severity,
						message: `the body has changed since generated.at was last stamped: generated.body_sha256 is ${recordedDigest}, the current body hashes to ${currentDigest}`,
					}),
				);
				continue;
			}

			// Tier 2: no digest recorded (an un-migrated concept) -- the original git-derived
			// date comparison, skipped entirely (no git call) when `skipGitTier` is set.
			if (skipGitTier) continue;
			const file = path.join(bundle.root, concept.path);
			const derived = yield* Derivation.generatedAt({ file }).pipe(
				Effect.catchTag("NotARepositoryError", () => Effect.succeed(undefined)),
			);
			// S-8: a bundle outside git has nothing to derive for any tier-2 concept -- the
			// first NotARepositoryError short-circuits the whole function.
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
						recorded === undefined ? "missing" : encodeAt(recorded)
					}; the last body change was ${encodeAt(derived.at)} (${derived.sha.slice(0, 7)})`,
				}),
			);
		}
		return diagnostics;
	});
}
