import { MarkdownEdit } from "@effected/markdown";
import type { Actor, ConceptId, LoadedBundle } from "@okfit/core";
import { Timestamp } from "@okfit/core";
import type { UncommittedReason } from "@okfit/profiles";
import { Derivation } from "@okfit/profiles";
import type { DateTime } from "effect";
import { Effect, FileSystem, Path, Schema } from "effect";
import {
	detectNewline,
	locateGenerated,
	locateGeneratedBlock,
	locateGeneratedBodySha256,
	stripBom,
} from "../verify/locate.js";
import { spliceGeneratedBlock, spliceGeneratedFields } from "../verify/splice.js";
import { writeAtomic } from "./write.js";

/**
 * The five `SkipReason` members contract §6.2's algorithm can actually
 * produce — a strict subset of contract §5's six-member `SkipReason`
 * (`sync/run.ts`, Task B3; the sixth, `"log-unparseable"`, is log mode's
 * alone). Declared locally because `sync/run.ts` does not exist when this
 * task lands (fixed order A1 -> A2 -> B1 -> B2 -> B3); every member here is
 * spelled identically to its `SkipReason` counterpart, so Task B3 assigns
 * a `GeneratedSkipReason` value into a `SkipReason`-typed field with no
 * cast.
 *
 * @internal
 */
export const GeneratedSkipReason = Schema.Literals([
	"untracked",
	"dirty",
	"unborn",
	"generated-missing",
	"generated-unsupported",
]);
/** @internal */
export type GeneratedSkipReason = typeof GeneratedSkipReason.Type;

/**
 * Contract §5's `SyncModeResult` minus `selected`, which is `runSync`'s
 * concern once all three modes' results are assembled (Task B3).
 *
 * @internal
 */
export interface GeneratedSyncResult {
	readonly written: ReadonlyArray<string>;
	readonly unchanged: ReadonlyArray<string>;
	readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: GeneratedSkipReason }>;
}

const encodeAt = Schema.encodeSync(Timestamp);

/**
 * What {@link syncGenerated} needs from provenance: `BodyProvenance` is
 * assignable to it (issue #140/#73).
 *
 * @internal
 */
export type GeneratedProvenance =
	| { readonly _tag: "committed"; readonly at: DateTime.Utc }
	| { readonly _tag: "uncommitted"; readonly reason: UncommittedReason };

/** @internal */
export interface SyncGeneratedOptions {
	readonly provenance: ReadonlyMap<ConceptId, GeneratedProvenance>;
	readonly dryRun: boolean;
	/** #73: when set, a concept with no generated block gets one created from this actor. */
	readonly agent?: Actor;
	/** #140: when set, only these concepts are considered; every other id is absent from all three lists. */
	readonly scope?: ReadonlySet<ConceptId>;
}

/**
 * Contract §6.2's algorithm, run once per `bundle.concepts` entry (S-22:
 * `index.md`/`log.md` are reserved files, never concepts, never seen here).
 * `options.provenance` is the single `Derivation.generatedAt` walk `runSync`
 * (Task B3) computes once and shares with log mode; this function never
 * calls git itself and never substitutes `now` for an uncommitted body
 * (design §3 rule 2). Every write is atomic (temp file plus rename in the
 * same directory), matching `verify`'s own discipline (`verify/run.ts`'s
 * `runVerify`).
 *
 * Ordering (later tasks rely on it): (1) scope filter -> (2) digest match
 * against `generated.body_sha256` => `unchanged`, BEFORE any provenance
 * lookup -> (3) provenance absent => `Effect.die` (caller contract) -> (4)
 * `uncommitted` => skipped with its reason -> (5) no `generated` block:
 * `agent` unset => skipped `generated-missing`, else create -> (6) existing
 * block: splice `at` + `body_sha256` as today.
 *
 * `locateGenerated`'s `YamlParseError` is folded into a defect here
 * (`Effect.orDie`), not widened into this function's typed error channel:
 * the frontmatter it re-parses already decoded once, successfully, for
 * this concept to be a member of `bundle.concepts` at all -- the same
 * reasoning `locate.ts`'s own `locate` documents for its identical
 * failure mode. `runSync`'s stated error union (`BundleLoadError |
 * GeneratedAtError`, contract §5) already includes `PlatformError.
 * PlatformError` inside `GeneratedAtError` (contract §14 note 2), so this
 * function's own `PlatformError.PlatformError` channel composes with no
 * widening on either side.
 *
 * @internal
 */
export const syncGenerated = Effect.fn("okfit/sync/syncGenerated")(function* (
	bundle: LoadedBundle,
	options: SyncGeneratedOptions,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const { provenance, dryRun, agent, scope } = options;

	const written: Array<string> = [];
	const unchanged: Array<string> = [];
	const skipped: Array<{ readonly id: string; readonly reason: GeneratedSkipReason }> = [];

	for (const [id, concept] of bundle.concepts) {
		// Step 1 (#140): a scoped run considers only the caller's set.
		if (scope !== undefined && !scope.has(id)) continue;

		// Step 2 (#19, now first): drift is decided by the digest alone. A match
		// needs no provenance at all, which is what lets runSync skip the git
		// walk for an already-stamped concept (#21).
		const generated = concept.frontmatter.generated;
		const currentDigest = yield* Derivation.bodyDigest(concept.document.source);
		if (generated?.body_sha256 !== undefined && generated.body_sha256 === currentDigest) {
			unchanged.push(id);
			continue;
		}

		// Step 3: every concept that reaches here needed a provenance entry from
		// runSync -- an absent one is a defect in that caller contract.
		const derived = provenance.get(id);
		if (derived === undefined) {
			return yield* Effect.die(new Error(`syncGenerated: no provenance computed for concept ${id}`));
		}

		// Step 4: never substitutes `now`.
		if (derived._tag === "uncommitted") {
			skipped.push({ id, reason: derived.reason });
			continue;
		}

		// Step 5 (#73): no block at all. With no agent configured there is
		// nothing to attribute a stamp to, so the file is never even opened.
		const creating = generated === undefined ? agent : undefined;
		if (generated === undefined && creating === undefined) {
			skipped.push({ id, reason: "generated-missing" });
			continue;
		}

		const absolutePath = path.join(bundle.root, concept.path);
		const source = yield* fs.readFileString(absolutePath);
		const { text, bom } = stripBom(source);
		const newline = detectNewline(text);
		const encodedAt = encodeAt(derived.at);

		let edits: ReadonlyArray<MarkdownEdit>;
		if (creating !== undefined) {
			// Step 5 continued: an agent IS configured -- create the whole mapping.
			const located = yield* locateGeneratedBlock(text).pipe(Effect.orDie);
			if (located._tag === "unsupported") {
				skipped.push({ id, reason: "generated-unsupported" });
				continue;
			}
			edits = [spliceGeneratedBlock(located, { by: creating, at: encodedAt, bodySha256: currentDigest }, newline)];
		} else {
			// Step 6: both fields locate independently -- either being unsupported skips the concept.
			const atLocated = yield* locateGenerated(text).pipe(Effect.orDie);
			const bodySha256Located = yield* locateGeneratedBodySha256(text).pipe(Effect.orDie);
			if (atLocated._tag === "unsupported" || bodySha256Located._tag === "unsupported") {
				skipped.push({ id, reason: "generated-unsupported" });
				continue;
			}
			edits = spliceGeneratedFields(atLocated, bodySha256Located, encodedAt, currentDigest, newline);
		}

		const finalText = bom + MarkdownEdit.applyAll(text, edits);
		if (dryRun) {
			written.push(id);
			continue;
		}
		yield* writeAtomic(absolutePath, finalText);
		written.push(id);
	}

	return { written, unchanged, skipped } satisfies GeneratedSyncResult;
});
