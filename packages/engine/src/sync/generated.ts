import { MarkdownEdit } from "@effected/markdown";
import type { Actor, ConceptId, Integrity, LoadedBundle, LoadedConcept } from "@okfit/core";
import { Timestamp, generatedAtIsFuture, verificationBlockingRestamp } from "@okfit/core";
import type { UncommittedReason } from "@okfit/profiles";
import { Derivation, PUBLICATION_TYPE, Trust } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import { FrontmatterEdits } from "../edits/FrontmatterEdits.js";
import {
	locateIntegrity,
	locateLegacyBodySha256,
	removeLine,
	renameKey,
	spliceIntegrity,
	spliceIntegrityGenerated,
} from "../verify/integrity.js";
import { detectNewline, locateGenerated, locateGeneratedBlock, stripBom } from "../verify/locate.js";
import { mergeSameOffset, spliceGenerated, spliceGeneratedBlock } from "../verify/splice.js";
import type { KeyRenamePlan, KeyRenames } from "./legacyKeys.js";
import {
	hasLegacyKeyNames,
	legacyIntegrity,
	planKeyRenames,
	recordedBodyForSync,
	rendersKeyFor,
} from "./legacyKeys.js";
import type { PendingWrite } from "./write.js";
import { readSourceKeepingBom, writeAtomic } from "./write.js";

/**
 * The `SkipReason` members contract §6.2's algorithm can actually produce — a
 * subset of `SkipReason` (`sync/run.ts`); the members it leaves out (the
 * log-mode and index-mode reasons, for example `"log-unparseable"` and
 * `"index-unparseable"`) belong to the other sync modes. Declared locally
 * because `sync/run.ts` does not exist when this task lands (fixed order
 * A1 -> A2 -> B1 -> B2 -> B3); every member here is spelled identically to
 * its `SkipReason` counterpart, so Task B3 assigns a `GeneratedSkipReason`
 * value into a `SkipReason`-typed field with no cast.
 *
 * @internal
 */
export const GeneratedSkipReason = Schema.Literals([
	"untracked",
	"dirty",
	"unborn",
	"generated-missing",
	"generated-unsupported",
	"integrity-unsupported",
	"renders-unsupported",
	"legacy-key-conflict",
	"legacy-key-unsupported",
	"verified-after-now",
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
	/**
	 * Ids whose legacy `generated.body_sha256` was moved to `x-okfit-integrity.generated.body`, or whose legacy key
	 * tokens were renamed. May overlap `written`, and may also appear in `skipped`: a concept sync cannot
	 * stamp still has its old keys renamed.
	 */
	readonly migrated: ReadonlyArray<string>;
	readonly skipped: ReadonlyArray<GeneratedSkip>;
	/**
	 * #509: each in-scope concept, once, whose existing `generated.at` or committed author date (before any clamp) is
	 * more than the tolerance later than `options.now`; `at` is the later of the two. Empty when `now` is unset. A
	 * run-level signal that the clock may be behind, not a per-mode result: `planSync` takes it out of the mode result.
	 */
	readonly ahead: ReadonlyArray<{ readonly id: string; readonly at: DateTime.Utc }>;
}

/**
 * One concept sync declined to stamp, or, for `verified-after-now`, left a held stamp on (a changed concept is still
 * written, so it may also be in `written`, or in `migrated` when it only migrates). `verified-after-now` also names
 * the two instants the human renderer quotes: the `generated.at` left in place and the earliest verification the
 * repair would have made current.
 *
 * @internal
 */
export interface GeneratedSkip {
	readonly id: string;
	readonly reason: GeneratedSkipReason;
	readonly generatedAt?: string;
	readonly verifiedAt?: string;
}

const encodeAt = Schema.encodeSync(Timestamp);

/**
 * R2 (#471): the earliest `verified[].at` with `from <= at < to`, the entries that lowering a stamp from `to` to
 * `from` would turn from not current into current. Sync never does that: it would raise the trust tier without a human.
 */
const earliestVerificationBetween = (
	concept: LoadedConcept,
	from: DateTime.Utc,
	to: DateTime.Utc,
): DateTime.Utc | undefined =>
	Option.getOrUndefined(
		verificationBlockingRestamp(
			(concept.frontmatter.verified ?? []).map((entry) => entry.at),
			to,
			from,
		),
	);

/** What {@link settle} decides about a stamp that may be ahead of the clock. */
type Settled =
	| { readonly _tag: "keep" }
	| { readonly _tag: "restamp" }
	| { readonly _tag: "held"; readonly verifiedAt: DateTime.Utc };

/**
 * #471/#509: a stamp more than the tolerance ahead of `now` moves to `now`, unless a verification dated in
 * `[now, stamp)` would then count: that is a real hold, reported `verified-after-now`. A stamp within the tolerance is kept.
 */
const settle = (concept: LoadedConcept, at: DateTime.Utc, now: DateTime.Utc, nowStamp: DateTime.Utc): Settled => {
	if (!generatedAtIsFuture(at, now)) return { _tag: "keep" };
	const verifiedAt = earliestVerificationBetween(concept, nowStamp, at);
	return verifiedAt === undefined ? { _tag: "restamp" } : { _tag: "held", verifiedAt };
};

const NO_KEY_PLAN: KeyRenamePlan = { _tag: "none" };

/**
 * For a Publication whose `renders` still carries a legacy `body_sha256`: the
 * per-entry `x-okfit-renders[].body` to write (existing `body`, else the legacy 16-hex
 * prefix), `undefined` for an entry with no legacy key. `undefined` overall when
 * there is nothing to migrate.
 */
const legacyRendersDigests = (
	concept: LoadedConcept,
	rendersKey: string | undefined,
): ReadonlyArray<string | undefined> | undefined => {
	if (concept.frontmatter.type !== PUBLICATION_TYPE || rendersKey === undefined) return undefined;
	const renders = concept.frontmatter.raw[rendersKey];
	if (!Array.isArray(renders)) return undefined;
	const digests = renders.map((entry: unknown) => {
		if (typeof entry !== "object" || entry === null) return undefined;
		const { body, body_sha256: legacy } = entry as { body?: unknown; body_sha256?: unknown };
		if (typeof legacy !== "string" || legacy === "") return undefined;
		return typeof body === "string" && body !== "" ? body : legacy.slice(0, 16);
	});
	return digests.some((d) => d !== undefined) ? digests : undefined;
};

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
	/** The key renames the config licenses (`keyRenamesFor`), computed once per run. */
	readonly renames: KeyRenames;
	/** When set (with `dryRun`), each write that would happen is recorded here, in order, so a caller can apply it later. */
	readonly pending?: Array<PendingWrite>;
	/** #73: when set, a concept with no generated block gets one created from this actor. */
	readonly agent?: Actor;
	/** #140: when set, only these concepts are considered; every other id is absent from all three lists. */
	readonly scope?: ReadonlySet<ConceptId>;
	/**
	 * #471: the run's clock. With it set, a stamp sync writes is never later than `startOf(now, "second")`, and a
	 * concept whose recorded digest matches but whose `generated.at` is later than `now` is re-stamped to that instant.
	 * A stamp that stays more than the tolerance ahead because lowering it would make a verification count is reported
	 * `verified-after-now` on that run (#509); a kept stamp that guards no such verification moves to `now`.
	 * Absent: none of this applies.
	 */
	readonly now?: DateTime.Utc;
}

/**
 * OKF 0.3 5.2/5.3 (R30): the instant to stamp as `generated.at`. When the concept's `x-okfit-integrity.verified` binds its
 * latest human entry and its content digest equals the digest of the concept as it
 * is now, the binding proves this content existed at `binding.at`, so its last meaningful change is no later than
 * that; the commit instant is only when git learned of it. The stamp is then `min(derived, binding.at)`, which keeps
 * the edit, verify, commit sequence's verification current. Any other case, including content that cannot be hashed,
 * stamps `derived` unchanged.
 *
 * The clamp applies only when `binding.at` is not earlier than the concept's existing `generated.at`. It exists for
 * edit, verify, commit, where the verification is at or after the previous stamp (`verify` refuses otherwise). A
 * binding older than the previous stamp means the content was reverted to something verified earlier, or the binding
 * was written by hand; the last meaningful change is then the new commit, so `derived` is stamped and `generated.at`
 * never moves backwards. A concept with no `generated.at` has no floor, and the clamp applies.
 *
 * Clamping to an earlier instant can make another verification event dated between `binding.at` and the commit
 * instant current; that is what OKF 0.3 5.3 prescribes for content that already existed at `binding.at`.
 *
 * The `[actors].humans` allow-list does not gate the clamp: integrity is tamper-evident, not access control (a
 * hand-written binding can name any actor), so gating on it would add a parameter and protect nothing.
 * `Trust.evaluate` still reports `actor-not-allowed` for such a binding.
 */
const stampInstant = (
	concept: LoadedConcept,
	derived: DateTime.Utc,
	legacy: { readonly block: Integrity; readonly key: string } | undefined,
) =>
	Effect.gen(function* () {
		const { frontmatter } = concept;
		const binding = Trust.boundEntry({
			verified: frontmatter.verified ?? [],
			binding: (frontmatter.integrity ?? legacy?.block)?.verified,
		});
		if (binding === undefined) return derived;
		if (!DateTime.isLessThan(binding.at, derived)) return derived;
		const previous = frontmatter.generated?.at;
		if (previous !== undefined && DateTime.isLessThan(binding.at, previous)) return derived;
		// The legacy block is not content: it is the key the rename makes the excluded `x-okfit-integrity`, and the
		// old `verify` hashed the document without it. Hashing it in would make the binding never match.
		const raw =
			legacy === undefined || frontmatter.integrity !== undefined
				? frontmatter.raw
				: Object.fromEntries(Object.entries(frontmatter.raw).filter(([key]) => key !== legacy.key));
		const content = yield* Effect.result(Derivation.contentDigest(raw, concept.document.source));
		return Result.isSuccess(content) && content.success === binding.content ? binding.at : derived;
	});

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
 * against the recorded body digest (`x-okfit-integrity.generated.body`, else the
 * legacy `generated.body_sha256` prefix) => `unchanged` (or a migrate-only
 * write when a legacy line still exists), BEFORE any provenance lookup -> (2b)
 * no `generated` block and `agent` unset => skipped `generated-missing` (before any
 * provenance lookup, so an uncommitted concept is told its real blocker first, #515) -> (3) provenance absent =>
 * `Effect.die` (caller contract) -> (4) `uncommitted` => skipped with its reason -> (5) no `generated` block, `agent`
 * set: create -> (6) existing block: splice `at`.
 * With `options.now` set, the stamp a path leaves is settled once more ({@link settle}): a stamp more than the tolerance
 * ahead moves to now, or, when a verification dated in `[now, stamp)` would then count, stays and is reported
 * `verified-after-now` (a changed concept is still written, so it may be in both `written` and `skipped`, or in
 * `migrated` and `skipped` when it only migrates).
 * Every write also sets `x-okfit-integrity.generated.body` (keeping `x-okfit-integrity.verified`)
 * and removes a legacy `body_sha256` line.
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
	const { provenance, dryRun, agent, scope, pending, renames } = options;
	const nowStamp = options.now === undefined ? undefined : DateTime.startOf(options.now, "second");

	const written: Array<string> = [];
	const unchanged: Array<string> = [];
	const migrated: Array<string> = [];
	const skipped: Array<GeneratedSkip> = [];
	const ahead: Array<{ readonly id: string; readonly at: DateTime.Utc }> = [];

	for (const [id, concept] of bundle.concepts) {
		// Step 1 (#140): a scoped run considers only the caller's set.
		if (scope !== undefined && !scope.has(id)) continue;

		// Step 2 (#19, now first): drift is decided by the digest alone. A match
		// needs no provenance at all, which is what lets runSync skip the git
		// walk for an already-stamped concept (#21).
		const generated = concept.frontmatter.generated;
		const currentDigest = yield* Derivation.bodyDigest(concept.document.source);
		// An unmigrated concept's digest is still its record: reading only the new key would see drift and
		// re-stamp `generated.at`, which voids every verification.
		const matches = recordedBodyForSync(concept, renames) === currentDigest;
		// #509: a stamp or an author date this far ahead of the clock means the clock may be behind. The author date counts
		// only where it would be stamped (a drifted concept), so the answer does not depend on which concepts were walked.
		if (options.now !== undefined) {
			const derivedAt = !matches ? provenance.get(id) : undefined;
			const derived = derivedAt?._tag === "committed" ? derivedAt.at : undefined;
			const latest =
				generated?.at !== undefined && derived !== undefined
					? DateTime.max(generated.at, derived)
					: (generated?.at ?? derived);
			if (latest !== undefined && generatedAtIsFuture(latest, options.now)) ahead.push({ id, at: latest });
		}
		const hasLegacy = generated?.body_sha256 !== undefined;
		const rendersKey = rendersKeyFor(concept, renames);
		const legacyRenders = legacyRendersDigests(concept, rendersKey);
		const legacyBlock = legacyIntegrity(concept, renames);
		const rawKeys = concept.frontmatter.raw;
		const keyCandidate = hasLegacyKeyNames(concept, renames);
		// #471: a stamp later than now behind a matching digest is not authoritative; one at or before now never is touched.
		// R2: re-stamping lowers `generated.at`; it must not make a verification count that did not before.
		const matchingSettled: Settled =
			matches && options.now !== undefined && nowStamp !== undefined && generated?.at !== undefined
				? settle(concept, generated.at, options.now, nowStamp)
				: { _tag: "keep" };
		const future = matchingSettled._tag === "restamp";
		// A held concept that another skip ends gets that skip alone: the hold is reported where the write lands.
		let heldChanged: { readonly generatedAt: string; readonly verifiedAt: string } | undefined =
			matchingSettled._tag === "held" && generated?.at !== undefined
				? { generatedAt: encodeAt(generated.at), verifiedAt: encodeAt(matchingSettled.verifiedAt) }
				: undefined;
		const reportHeld = () => {
			if (heldChanged !== undefined) skipped.push({ id, reason: "verified-after-now", ...heldChanged });
		};
		if (matches && !future && !hasLegacy && legacyRenders === undefined && !keyCandidate) {
			if (heldChanged !== undefined) reportHeld();
			else unchanged.push(id);
			continue;
		}

		// The key rename is a pure token edit: it needs no provenance, no `generated` block and no body check.
		// So it is planned first, and a concept that cannot be stamped still gets the rename-only write below.
		const absolutePath = path.join(bundle.root, concept.path);
		const source = keyCandidate ? yield* readSourceKeepingBom(fs, absolutePath) : undefined;
		const keyPlan =
			source === undefined
				? NO_KEY_PLAN
				: yield* planKeyRenames(stripBom(source).text, concept, renames).pipe(Effect.orDie);
		// D4: both spellings, or a legacy key that cannot be renamed in place, skip the whole concept.
		if (keyPlan._tag === "conflict") {
			skipped.push({ id, reason: "legacy-key-conflict" });
			continue;
		}
		if (keyPlan._tag === "unsupported") {
			skipped.push({ id, reason: "legacy-key-unsupported" });
			continue;
		}
		const legacyKey =
			renames.integrity !== undefined &&
			concept.frontmatter.integrity === undefined &&
			Object.hasOwn(rawKeys, renames.integrity.from) &&
			(rawKeys[renames.integrity.from] === null ||
				legacyBlock !== undefined ||
				// A plan that only renames profile fields must not claim a foreign `integrity` as okfit's block.
				(keyPlan._tag === "edits" && keyPlan.keys.includes(renames.integrity.from)))
				? renames.integrity.from
				: undefined;

		/**
		 * Skip the stamp for `reason`, but still move the old key tokens: a rename never re-attests, so it is
		 * written whether or not the concept can be stamped. The id lands in both `migrated` and `skipped`.
		 */
		const skipKeepingRename = (reason: GeneratedSkipReason) =>
			Effect.gen(function* () {
				if (source !== undefined) {
					const { text, bom } = stripBom(source);
					const edits: Array<MarkdownEdit> = keyPlan._tag === "edits" ? [...keyPlan.edits] : [];
					// An empty legacy block (`integrity:` or `~`) is not in the plan: its key token moves, its value stays.
					if (legacyKey !== undefined && rawKeys[legacyKey] === null && renames.integrity !== undefined) {
						const located = yield* locateIntegrity(text, { key: legacyKey }).pipe(Effect.orDie);
						if (located._tag === "replace") edits.push(renameKey(located.keySpan, renames.integrity.to, text));
					}
					if (edits.length > 0) {
						const finalText =
							bom +
							MarkdownEdit.applyAll(
								text,
								edits.toSorted((a, b) => a.offset - b.offset),
							);
						migrated.push(id);
						if (!dryRun) yield* writeAtomic(absolutePath, finalText);
						else pending?.push({ target: absolutePath, contents: finalText, before: concept.document.source });
					}
				}
				skipped.push({ id, reason });
			});

		// Step 3: every drifted concept needed a provenance entry from runSync --
		// an absent one is a defect in that caller contract. A migrate-only write
		// (digest matches) needs none.
		let encodedAt: string | undefined;
		// Step 3b (#73, #515): a concept with no `generated` block and no agent to attribute a stamp to can never be
		// stamped, so name that blocker first: skipping it as uncommitted would send the author to commit it, and the
		// next sync would then skip it again as `generated-missing`. The file is never even opened for the stamp.
		const creating = generated === undefined ? agent : undefined;
		if (!matches && generated === undefined && creating === undefined) {
			yield* skipKeepingRename("generated-missing");
			continue;
		}
		// `future` implies `now` was given; the `nowStamp` test only narrows its type.
		if (future && nowStamp !== undefined) {
			encodedAt = encodeAt(nowStamp);
		} else if (!matches) {
			const derived = provenance.get(id);
			if (derived === undefined) {
				return yield* Effect.die(new Error(`syncGenerated: no provenance computed for concept ${id}`));
			}
			// Step 4: never substitutes `now`.
			if (derived._tag === "uncommitted") {
				yield* skipKeepingRename(derived.reason);
				continue;
			}
			const stamped = yield* stampInstant(
				concept,
				derived.at,
				legacyBlock === undefined || renames.integrity === undefined
					? undefined
					: { block: legacyBlock, key: renames.integrity.from },
			);
			// #471: never write a stamp later than now (a skewed author clock), unless lowering it would make a
			// verification dated in between count (R2): then the unclamped stamp stands and is reported
			// `verified-after-now` on this run (the lint reports it too).
			const candidate =
				nowStamp !== undefined &&
				DateTime.isGreaterThan(stamped, nowStamp) &&
				earliestVerificationBetween(concept, nowStamp, stamped) === undefined
					? nowStamp
					: stamped;
			// R2 against the stamp being replaced: a stamp is never moved back below a verification. The binding clamp
			// in `stampInstant` never goes below the existing stamp, so it is unaffected; the final candidate is judged last.
			const previous = generated?.at;
			const final =
				previous !== undefined &&
				DateTime.isLessThan(candidate, previous) &&
				earliestVerificationBetween(concept, candidate, previous) !== undefined
					? previous
					: candidate;
			// #509: judge the final stamp once more. A kept future stamp that guards only verifications before now
			// moves to now on this run; one that guards a verification dated after now is reported as held.
			const settled: Settled =
				options.now !== undefined && nowStamp !== undefined
					? settle(concept, final, options.now, nowStamp)
					: { _tag: "keep" };
			if (settled._tag === "held") {
				heldChanged = { generatedAt: encodeAt(final), verifiedAt: encodeAt(settled.verifiedAt) };
			}
			encodedAt = encodeAt(settled._tag === "restamp" && nowStamp !== undefined ? nowStamp : final);
		}

		const fileSource = source ?? (yield* readSourceKeepingBom(fs, absolutePath));
		const { text, bom } = stripBom(fileSource);
		const newline = detectNewline(text);

		// A legacy integrity block (D2, null included) is located under its old spelling; an empty one is
		// then written whole under the new key rather than renamed.
		const integrityLocated = yield* locateIntegrity(
			text,
			legacyKey === undefined ? undefined : { key: legacyKey },
		).pipe(Effect.orDie);
		if (integrityLocated._tag === "unsupported") {
			yield* skipKeepingRename("integrity-unsupported");
			continue;
		}
		const legacy = yield* locateLegacyBodySha256(text).pipe(Effect.orDie);
		if (hasLegacy && legacy._tag === "none") {
			// The parsed concept carries a legacy digest we cannot locate as a plain line (flow style).
			yield* skipKeepingRename("generated-unsupported");
			continue;
		}

		const edits: Array<MarkdownEdit> = [];
		if (encodedAt !== undefined) {
			if (creating !== undefined) {
				// Step 5 continued: an agent IS configured -- create the whole mapping.
				const located = yield* locateGeneratedBlock(text).pipe(Effect.orDie);
				if (located._tag === "unsupported") {
					yield* skipKeepingRename("generated-unsupported");
					continue;
				}
				edits.push(spliceGeneratedBlock(located, { by: creating, at: encodedAt }, newline));
			} else {
				// Step 6: an existing block -- stamp `at` alone.
				const atLocated = yield* locateGenerated(text).pipe(Effect.orDie);
				if (atLocated._tag === "unsupported") {
					yield* skipKeepingRename("generated-unsupported");
					continue;
				}
				edits.push(spliceGenerated(atLocated, encodedAt, newline, "at"));
			}
		}
		if (legacy._tag === "line") edits.push(removeLine(legacy));
		if (legacyRenders !== undefined) {
			const renderEdits = yield* FrontmatterEdits.rendersDigests(text, legacyRenders, rendersKey).pipe(
				Effect.catchTags({ UnsupportedFrontmatterError: () => Effect.succeed(undefined) }),
				Effect.orDie,
			);
			if (renderEdits === undefined) {
				yield* skipKeepingRename("renders-unsupported");
				continue;
			}
			edits.push(...renderEdits);
		}
		if (keyPlan._tag === "edits") edits.push(...keyPlan.edits);
		// A renamed block that already records this body needs only its key token moved.
		const recorded =
			legacyKey !== undefined &&
			integrityLocated._tag === "replace" &&
			integrityLocated.slots.length > 0 &&
			integrityLocated.current?.generated?.body === currentDigest;
		if (!recorded) {
			// An empty legacy block holds nothing to keep: write it whole under the new key.
			const emptyLegacy =
				legacyKey !== undefined && integrityLocated._tag === "replace" && integrityLocated.slots.length === 0;
			edits.push(
				emptyLegacy
					? spliceIntegrity(integrityLocated, { generated: { body: currentDigest } }, newline)
					: spliceIntegrityGenerated(integrityLocated, text, currentDigest, newline),
			);
		}

		const finalText = bom + MarkdownEdit.applyAll(text, mergeSameOffset(edits.toSorted((a, b) => a.offset - b.offset)));
		// A block the parsed concept could not decode (say a malformed `x-okfit-integrity.verified`) never
		// matches, so its re-stamp can reproduce the file byte for byte: report that as unchanged,
		// not as a write that would recur on every run.
		if (finalText === fileSource) {
			if (heldChanged !== undefined) reportHeld();
			else unchanged.push(id);
			continue;
		}
		if (legacy._tag === "line" || legacyRenders !== undefined || keyPlan._tag === "edits" || legacyKey !== undefined) {
			migrated.push(id);
		}
		if (!dryRun) {
			yield* writeAtomic(absolutePath, finalText);
		} else {
			pending?.push({ target: absolutePath, contents: finalText, before: concept.document.source });
		}
		if (!matches || future) written.push(id);
		reportHeld();
	}

	return { written, unchanged, migrated, skipped, ahead } satisfies GeneratedSyncResult;
});
