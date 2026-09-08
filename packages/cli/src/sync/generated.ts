import { MarkdownEdit } from "@effected/markdown";
import type { ConceptId, LoadedBundle } from "@okfit/core";
import { Timestamp } from "@okfit/core";
import type { BodyProvenance } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Path, Schema } from "effect";
import { detectNewline, locateGenerated, stripBom } from "../verify/locate.js";
import { spliceGenerated } from "../verify/splice.js";
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
 * Contract §6.2's twelve-step algorithm, run once per `bundle.concepts`
 * entry (S-22: `index.md`/`log.md` are reserved files, never concepts,
 * never seen here). `provenance` is the single `Derivation.generatedAt`
 * walk `runSync` (Task B3) computes once and shares with log mode; this
 * function never calls git itself and never substitutes `now` for an
 * uncommitted body (design §3 rule 2). Every write is atomic (temp file
 * plus rename in the same directory), matching `verify`'s own discipline
 * (`verify/run.ts`'s `runVerify`).
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
	provenance: ReadonlyMap<ConceptId, BodyProvenance>,
	dryRun: boolean,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;

	const written: Array<string> = [];
	const unchanged: Array<string> = [];
	const skipped: Array<{ readonly id: string; readonly reason: GeneratedSkipReason }> = [];

	for (const [id, concept] of bundle.concepts) {
		// Step 1: `runSync` computes one provenance entry per bundle.concepts
		// id before calling syncGenerated at all (contract §6.2 step 1) -- an
		// absent entry here is a defect in that caller contract, not a skip
		// reason this function invents.
		const derived = provenance.get(id);
		if (derived === undefined) {
			return yield* Effect.die(new Error(`syncGenerated: no provenance computed for concept ${id}`));
		}

		// Step 2: never substitutes `now`.
		if (derived._tag === "uncommitted") {
			skipped.push({ id, reason: derived.reason });
			continue;
		}

		// Step 3: a caller-level check against the already-decoded concept,
		// never locateGenerated's own (FW §3, design §3 rule 5).
		const generated = concept.frontmatter.generated;
		if (generated === undefined) {
			skipped.push({ id, reason: "generated-missing" });
			continue;
		}

		// Steps 4-6: instants, never encoded strings (S-6).
		const recorded = generated.at;
		if (recorded !== undefined && DateTime.Equivalence(recorded, derived.at)) {
			unchanged.push(id);
			continue;
		}

		// Step 7.
		const absolutePath = path.join(bundle.root, concept.path);
		const source = yield* fs.readFileString(absolutePath);
		const { text, bom } = stripBom(source);
		const newline = detectNewline(text);

		// Steps 8-9.
		const located = yield* locateGenerated(text).pipe(Effect.orDie);
		if (located._tag === "unsupported") {
			skipped.push({ id, reason: "generated-unsupported" });
			continue;
		}

		// Step 10.
		const encodedAt = encodeAt(derived.at);
		const edit = spliceGenerated(located, encodedAt, newline);
		const finalText = bom + MarkdownEdit.applyAll(text, [edit]);

		// Step 11: a dry run computes every result and writes nothing.
		if (dryRun) {
			written.push(id);
			continue;
		}

		// Step 12: one shared atomic writer across all three sync modes (S-33).
		yield* writeAtomic(absolutePath, finalText);
		written.push(id);
	}

	return { written, unchanged, skipped } satisfies GeneratedSyncResult;
});
