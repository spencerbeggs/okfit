import type { Actor, LoadedBundle, LoadedConcept, Staleness, TrustTier, Verification } from "@okfit/core";
import {
	Actor as ActorNS,
	Concept,
	Derive,
	Diagnostic,
	DiagnosticRange,
	INTEGRITY_KEY,
	OkfitConfig,
	Timestamp,
} from "@okfit/core";
import { DateTime, Effect, Result, Schema } from "effect";
import type { Digest } from "effect/crypto";
import { Derivation } from "./Derivation.js";

const encodeAt = Schema.encodeSync(Timestamp);

/**
 * Whether a concept's human verification still covers its content: `none` (no
 * `human:` entry in `verified`), `current` (the latest human entry is bound by
 * `integrity.verified` and the content digest still matches), or `drifted`.
 *
 * @public
 */
export type IntegrityState = "current" | "drifted" | "none";

/**
 * Why a human verification no longer binds: the content changed, the entry has
 * no `integrity.verified` binding, a later human entry is not the bound one, the
 * bound actor fails a non-empty `[actors].humans` allow-list, the bound entry
 * was made before the last change to the content (`at` earlier than
 * `generated.at`, OKF 0.3 §5.3, so it is no longer a current event), or the
 * content cannot be hashed at all (an unpaired surrogate; okfit#327), so the
 * binding cannot be checked.
 *
 * @public
 */
export const DriftReason = Schema.Literals([
	"content-changed",
	"unbound",
	"entry-superseded",
	"actor-not-allowed",
	"content-unhashable",
	"verified-before-change",
]);
/**
 * The type of {@link (DriftReason:variable)}.
 * @public
 */
export type DriftReason = typeof DriftReason.Type;

/**
 * The trust signal for one concept: its tier, whether its human verification
 * still binds, and staleness. `drift` is present only when `integrity` is
 * `drifted`.
 *
 * @public
 */
export interface ConceptSignal {
	readonly tier: TrustTier;
	readonly integrity: IntegrityState;
	readonly drift?: {
		readonly reason: DriftReason;
		readonly editedBy?: Actor;
		readonly editedAt?: string;
		/** For `content-unhashable`: why, and the offending frontmatter path. */
		readonly unhashable?: { readonly detail: string; readonly path: ReadonlyArray<string | number> };
	};
	readonly stale: boolean;
	/** `Derive.staleness`: `stale` is true only for `stale`; `malformed` is an unreadable `stale_after` (OKF 0.3 §5.5). */
	readonly staleness: Staleness;
}

/** Only `human:` entries bind; machine entries neither bind nor break a binding. */
const latestHumanOf = <E extends { readonly by: Actor; readonly at: DateTime.Utc }>(
	entries: ReadonlyArray<E>,
): E | undefined =>
	entries
		.filter((entry) => ActorNS.isHuman(entry.by))
		.reduce<E | undefined>(
			(latest, entry) =>
				latest === undefined || DateTime.isGreaterThanOrEqualTo(entry.at, latest.at) ? entry : latest,
			undefined,
		);

const latestHuman = (concept: LoadedConcept): Verification | undefined =>
	latestHumanOf(concept.frontmatter.verified ?? []);

/**
 * What the integrity decision reads from a concept: its `verified` entries, the
 * `integrity.verified` binding, and `generated`. Built by {@link Trust.inputOf}.
 *
 * @public
 */
export interface EvaluateInput {
	readonly verified: ReadonlyArray<{ readonly by: Actor; readonly at: DateTime.Utc }>;
	readonly binding: { readonly by: Actor; readonly at: DateTime.Utc; readonly content: string } | undefined;
	readonly generated: { readonly by: Actor; readonly at?: DateTime.Utc } | undefined;
	/** The `[actors].humans` allow-list; empty allows anyone. */
	readonly humans: ReadonlyArray<string>;
}

const inputOf = (concept: LoadedConcept, config: OkfitConfig): EvaluateInput => ({
	verified: concept.frontmatter.verified ?? [],
	binding: concept.frontmatter.integrity?.verified,
	generated: concept.frontmatter.generated,
	humans: config.actors?.humans ?? [],
});

/** What the bound-entry rule reads: the `verified` entries and the binding; no allow-list, no `generated`. */
type BoundInput = Pick<EvaluateInput, "verified" | "binding">;

/** The binding when it names the latest human entry; `undefined` when none, unbound or superseded. */
const boundEntry = (input: BoundInput): NonNullable<EvaluateInput["binding"]> | undefined => {
	const latest = latestHumanOf(input.verified);
	const binding = input.binding;
	if (latest === undefined || binding === undefined) return undefined;
	return binding.by === latest.by && DateTime.Equivalence(binding.at, latest.at) ? binding : undefined;
};

/** The editor fields of a `verified-before-change` drift: who stamped the `generated.at` the binding predates. */
const editorOf = (input: EvaluateInput) =>
	input.generated?.at === undefined ? {} : { editedBy: input.generated.by, editedAt: encodeAt(input.generated.at) };

/** OKF 0.3 §5.3: the bound entry is a current event only while its `at` is at or after `generated.at`. */
const boundBeforeChange = (input: EvaluateInput, binding: NonNullable<EvaluateInput["binding"]>): boolean =>
	!Derive.isCurrent({ generated: input.generated }, binding.at);

const needsDigest = (input: EvaluateInput): boolean => {
	const bound = boundEntry(input);
	return bound !== undefined && ActorNS.allowed(bound.by, input.humans) && !boundBeforeChange(input, bound);
};

const evaluate = (
	input: EvaluateInput,
	content: string | undefined,
): { readonly integrity: IntegrityState; readonly drift?: NonNullable<ConceptSignal["drift"]> } => {
	const latest = latestHumanOf(input.verified);
	if (latest === undefined) return { integrity: "none" };
	const binding = input.binding;
	if (binding === undefined) return { integrity: "drifted", drift: { reason: "unbound" } };
	if (boundEntry(input) === undefined) return { integrity: "drifted", drift: { reason: "entry-superseded" } };
	if (!ActorNS.allowed(binding.by, input.humans))
		return { integrity: "drifted", drift: { reason: "actor-not-allowed" } };
	if (boundBeforeChange(input, binding))
		return { integrity: "drifted", drift: { reason: "verified-before-change", ...editorOf(input) } };
	if (content === undefined) throw new Error("Trust.evaluate: a bound verification needs a content digest");
	if (content === binding.content) return { integrity: "current" };
	// A later `generated.at` would have returned `verified-before-change` above, so no editor is known here.
	return { integrity: "drifted", drift: { reason: "content-changed" } };
};

const signal = Effect.fn("Trust.signal")(function* (concept: LoadedConcept, config: OkfitConfig, now: DateTime.Utc) {
	const tier = Derive.trustTier(concept.frontmatter);
	const staleness = Derive.staleness(concept.frontmatter, now);
	const stale = staleness === "stale";
	const input = inputOf(concept, config);
	if (!needsDigest(input)) return { tier, stale, staleness, ...evaluate(input, undefined) } satisfies ConceptSignal;
	const content = yield* Effect.result(Derivation.contentDigest(concept.frontmatter.raw, concept.document.source));
	if (Result.isFailure(content)) {
		const { detail, path } = content.failure;
		return {
			tier,
			stale,
			staleness,
			integrity: "drifted",
			drift: { reason: "content-unhashable", unhashable: { detail, path } },
		} satisfies ConceptSignal;
	}
	return { tier, stale, staleness, ...evaluate(input, content.success) } satisfies ConceptSignal;
});

const signals = Effect.fn("Trust.signals")(function* (bundle: LoadedBundle, config: OkfitConfig, now: DateTime.Utc) {
	const out = new Map<string, ConceptSignal>();
	for (const [id, concept] of bundle.concepts) out.set(id, yield* signal(concept, config, now));
	return out;
});

const messageFor = (concept: LoadedConcept, drift: NonNullable<ConceptSignal["drift"]>): string => {
	const latest = latestHuman(concept);
	const by = latest?.by ?? "a human";
	const at = latest === undefined ? "an unknown time" : encodeAt(latest.at);
	if (drift.reason === "unbound") {
		return `verified by ${by} at ${at}, but no integrity.verified binding records what was verified; re-run okfit verify`;
	}
	if (drift.reason === "entry-superseded") {
		return `the latest human verification (${by} at ${at}) is not the one integrity.verified binds; re-run okfit verify`;
	}
	const binding = concept.frontmatter.integrity?.verified;
	if (drift.reason === "content-unhashable") {
		const where =
			drift.unhashable === undefined || drift.unhashable.path.length === 0
				? "the frontmatter"
				: drift.unhashable.path.join(".");
		return `${where} cannot be hashed (${drift.unhashable?.detail ?? "not canonicalizable"}), so the verification by ${binding?.by ?? by} cannot be checked; fix the value, then re-run okfit verify`;
	}
	if (drift.reason === "actor-not-allowed") {
		return `verified by ${binding?.by ?? by}, who is not in [actors].humans; a listed human re-runs okfit verify`;
	}
	if (drift.reason === "verified-before-change") {
		return `verified by ${binding?.by ?? by} at ${binding === undefined ? at : encodeAt(binding.at)}, before the last change at ${drift.editedAt ?? "an unknown time"}; re-run okfit verify`;
	}
	if (drift.reason === "content-changed") {
		return `content changed since ${binding?.by ?? by} verified it at ${binding === undefined ? at : encodeAt(binding.at)}; re-run okfit verify`;
	}
	return drift.reason satisfies never;
};

/**
 * Where a `verified-drift` finding points (spec section 6): the offending value for
 * `content-unhashable`, else the binding when one exists, else the latest human `verified` entry -- by its list index when `verified` is a
 * sequence, the key itself when it is a single bare mapping.
 */
const rangePath = (
	concept: LoadedConcept,
	drift: NonNullable<ConceptSignal["drift"]>,
): ReadonlyArray<string | number> => {
	if (drift.unhashable !== undefined && drift.unhashable.path.length > 0) return drift.unhashable.path;
	if (concept.frontmatter.integrity?.verified !== undefined) return [INTEGRITY_KEY, "verified"];
	const latest = latestHuman(concept);
	const index = latest === undefined ? -1 : (concept.frontmatter.verified ?? []).indexOf(latest);
	return index >= 0 ? Concept.entryPath(concept.frontmatter, "verified", index) : ["verified"];
};

const lint = Effect.fn("Trust.lint")(function* (
	bundle: LoadedBundle,
	config: OkfitConfig,
	now: DateTime.Utc,
	given?: ReadonlyMap<string, ConceptSignal>,
) {
	const severity = OkfitConfig.severityFor(config, "verified-drift");
	if (severity === "off") return [];
	const diagnostics: Array<Diagnostic> = [];
	for (const [id, concept] of bundle.concepts) {
		// `okfit verify` refuses drafts, deprecated concepts and an unknown status, so a warning on one could never
		// be cleared (`value-unknown` already warns about the last).
		const status = Derive.status(concept.frontmatter);
		if (status === "draft" || status === "deprecated" || status === "unknown") continue;
		const result = given?.get(id) ?? (yield* signal(concept, config, now));
		// core's `verified-before-change` lint is the one reporter of that defect (R31)
		if (result.drift === undefined || result.drift.reason === "verified-before-change") continue;
		const range = DiagnosticRange.forFrontmatterPath(concept.document, rangePath(concept, result.drift));
		diagnostics.push(
			Diagnostic.make({
				file: concept.path,
				code: "verified-drift",
				severity,
				message: messageFor(concept, result.drift),
				...(range === undefined ? {} : { range }),
			}),
		);
	}
	return diagnostics;
});

/**
 * The integrity trust signal: whether a human verification still binds the
 * content it covered, and the `verified-drift` lint built on it. A signal, not
 * a tamper seal. Named `Trust` so it does not collide with core's `Integrity`
 * schema.
 *
 * @public
 */
export class Trust {
	private constructor() {}
	/** The signal for one concept under `config`; hashes only when a human entry is bound by an allowed actor. */
	static readonly signal: (
		concept: LoadedConcept,
		config: OkfitConfig,
		now: DateTime.Utc,
	) => Effect.Effect<ConceptSignal, never, Digest.Digest> = signal;
	/** The signal for every concept in a bundle, keyed by concept id. */
	static readonly signals: (
		bundle: LoadedBundle,
		config: OkfitConfig,
		now: DateTime.Utc,
	) => Effect.Effect<Map<string, ConceptSignal>, never, Digest.Digest> = signals;
	/** Pure integrity decision; no hashing. `content` may be `undefined` only when {@link Trust.needsDigest} is false. */
	static readonly evaluate: (
		input: EvaluateInput,
		content: string | undefined,
	) => { readonly integrity: IntegrityState; readonly drift?: NonNullable<ConceptSignal["drift"]> } = evaluate;
	/** True iff the latest human entry is bound by `integrity.verified` and its actor passes the allow-list, i.e. a digest is needed. */
	static readonly needsDigest: (input: EvaluateInput) => boolean = needsDigest;
	/**
	 * The `integrity.verified` binding when it names the latest human entry (same actor, same instant); `undefined` when
	 * there is no human entry, no binding, or the binding is superseded. It ignores the `[actors].humans` allow-list and
	 * whether the entry is current, which are {@link Trust.evaluate}'s questions.
	 *
	 * @public
	 */
	static readonly boundEntry: (input: Pick<EvaluateInput, "verified" | "binding">) => EvaluateInput["binding"] =
		boundEntry;
	/** The {@link EvaluateInput} of a loaded concept. */
	static readonly inputOf: (concept: LoadedConcept, config: OkfitConfig) => EvaluateInput = inputOf;
	/**
	 * `verified-drift` diagnostics for drifted concepts (drafts and deprecated concepts are exempt: `okfit verify` refuses them); `[]` (no hashing) when the severity is `off`.
	 * Given `signals` (from {@link Trust.signals}) it reuses each concept's entry and hashes nothing for it;
	 * a concept absent from `signals` falls back to computing its own signal (hashing if it needs a digest).
	 */
	static readonly lint: (
		bundle: LoadedBundle,
		config: OkfitConfig,
		now: DateTime.Utc,
		signals?: ReadonlyMap<string, ConceptSignal>,
	) => Effect.Effect<Array<Diagnostic>, never, Digest.Digest> = lint;
}
