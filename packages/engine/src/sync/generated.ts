import { MarkdownEdit } from "@effected/markdown";
import type { Actor, ConceptId, Integrity, LoadedBundle, LoadedConcept } from "@okfit/core";
import { Timestamp } from "@okfit/core";
import type { UncommittedReason } from "@okfit/profiles";
import { Derivation, PUBLICATION_TYPE, Trust } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Path, Result, Schema } from "effect";
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
import { legacyIntegrity, planKeyRenames, recordedBodyForSync, rendersKeyFor } from "./legacyKeys.js";
import type { PendingWrite } from "./write.js";
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
	"integrity-unsupported",
	"renders-unsupported",
	"legacy-key-conflict",
	"legacy-key-unsupported",
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
	 * Ids whose legacy `generated.body_sha256` was moved to `integrity.generated.body`, or whose legacy key
	 * tokens were renamed. May overlap `written`, and may also appear in `skipped`: a concept sync cannot
	 * stamp still has its old keys renamed.
	 */
	readonly migrated: ReadonlyArray<string>;
	readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: GeneratedSkipReason }>;
}

const encodeAt = Schema.encodeSync(Timestamp);

const NO_KEY_PLAN: KeyRenamePlan = { _tag: "none" };

/**
 * For a Publication whose `renders` still carries a legacy `body_sha256`: the
 * per-entry `renders[].body` to write (existing `body`, else the legacy 16-hex
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
}

/**
 * OKF 0.3 5.2/5.3 (R30): the instant to stamp as `generated.at`. When the concept's `integrity.verified` binds its
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
 * against the recorded body digest (`integrity.generated.body`, else the
 * legacy `generated.body_sha256` prefix) => `unchanged` (or a migrate-only
 * write when a legacy line still exists), BEFORE any provenance lookup -> (3)
 * provenance absent => `Effect.die` (caller contract) -> (4) `uncommitted` =>
 * skipped with its reason -> (5) no `generated` block: `agent` unset =>
 * skipped `generated-missing`, else create -> (6) existing block: splice `at`.
 * Every write also sets `integrity.generated.body` (keeping `integrity.verified`)
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

	const written: Array<string> = [];
	const unchanged: Array<string> = [];
	const migrated: Array<string> = [];
	const skipped: Array<{ readonly id: string; readonly reason: GeneratedSkipReason }> = [];

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
		const hasLegacy = generated?.body_sha256 !== undefined;
		const rendersKey = rendersKeyFor(concept, renames);
		const legacyRenders = legacyRendersDigests(concept, rendersKey);
		const legacyBlock = legacyIntegrity(concept, renames);
		const rawKeys = concept.frontmatter.raw;
		const keyCandidate =
			(renames.integrity !== undefined && Object.hasOwn(rawKeys, renames.integrity.from)) ||
			(renames.fields.get(concept.frontmatter.type) ?? []).some((rename) => Object.hasOwn(rawKeys, rename.from));
		if (matches && !hasLegacy && legacyRenders === undefined && !keyCandidate) {
			unchanged.push(id);
			continue;
		}

		// The key rename is a pure token edit: it needs no provenance, no `generated` block and no body check.
		// So it is planned first, and a concept that cannot be stamped still gets the rename-only write below.
		const absolutePath = path.join(bundle.root, concept.path);
		const source = keyCandidate ? yield* fs.readFileString(absolutePath) : undefined;
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
			(rawKeys[renames.integrity.from] === null || legacyBlock !== undefined || keyPlan._tag === "edits")
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
						else pending?.push({ target: absolutePath, contents: finalText });
					}
				}
				skipped.push({ id, reason });
			});

		// Step 3: every drifted concept needed a provenance entry from runSync --
		// an absent one is a defect in that caller contract. A migrate-only write
		// (digest matches) needs none.
		let encodedAt: string | undefined;
		if (!matches) {
			const derived = provenance.get(id);
			if (derived === undefined) {
				return yield* Effect.die(new Error(`syncGenerated: no provenance computed for concept ${id}`));
			}
			// Step 4: never substitutes `now`.
			if (derived._tag === "uncommitted") {
				yield* skipKeepingRename(derived.reason);
				continue;
			}
			encodedAt = encodeAt(
				yield* stampInstant(
					concept,
					derived.at,
					legacyBlock === undefined || renames.integrity === undefined
						? undefined
						: { block: legacyBlock, key: renames.integrity.from },
				),
			);
		}

		// Step 5 (#73): no block at all. With no agent configured there is
		// nothing to attribute a stamp to, so the file is never even opened.
		const creating = generated === undefined ? agent : undefined;
		if (!matches && generated === undefined && creating === undefined) {
			yield* skipKeepingRename("generated-missing");
			continue;
		}

		const fileSource = source ?? (yield* fs.readFileString(absolutePath));
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
		// A block the parsed concept could not decode (say a malformed `integrity.verified`) never
		// matches, so its re-stamp can reproduce the file byte for byte: report that as unchanged,
		// not as a write that would recur on every run.
		if (finalText === fileSource) {
			unchanged.push(id);
			continue;
		}
		if (legacy._tag === "line" || legacyRenders !== undefined || keyPlan._tag === "edits" || legacyKey !== undefined) {
			migrated.push(id);
		}
		if (!dryRun) {
			yield* writeAtomic(absolutePath, finalText);
		} else {
			pending?.push({ target: absolutePath, contents: finalText });
		}
		if (!matches) written.push(id);
	}

	return { written, unchanged, migrated, skipped } satisfies GeneratedSyncResult;
});
