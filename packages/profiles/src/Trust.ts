import type { Actor, LoadedBundle, LoadedConcept, TrustTier, Verification } from "@okfit/core";
import { Actor as ActorNS, Derive, Diagnostic, DiagnosticRange, OkfitConfig, Timestamp } from "@okfit/core";
import type { Crypto, PlatformError } from "effect";
import { DateTime, Effect, Schema } from "effect";
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
 * no `integrity.verified` binding, a later human entry is not the bound one, or
 * the bound actor fails a non-empty `[actors].humans` allow-list.
 *
 * @public
 */
export const DriftReason = Schema.Literals(["content-changed", "unbound", "entry-superseded", "actor-not-allowed"]);
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
	readonly drift?: { readonly reason: DriftReason; readonly editedBy?: Actor; readonly editedAt?: string };
	readonly stale: boolean;
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

/** The binding when it names the latest human entry; `undefined` when none, unbound or superseded. */
const boundEntry = (input: EvaluateInput): NonNullable<EvaluateInput["binding"]> | undefined => {
	const latest = latestHumanOf(input.verified);
	const binding = input.binding;
	if (latest === undefined || binding === undefined) return undefined;
	return binding.by === latest.by && DateTime.Equivalence(binding.at, latest.at) ? binding : undefined;
};

const needsDigest = (input: EvaluateInput): boolean => {
	const bound = boundEntry(input);
	return bound !== undefined && ActorNS.allowed(bound.by, input.humans);
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
	if (content === undefined) throw new Error("Trust.evaluate: a bound verification needs a content digest");
	if (content === binding.content) return { integrity: "current" };
	const generated = input.generated;
	const edited =
		generated?.at !== undefined && DateTime.isGreaterThan(generated.at, binding.at)
			? { editedBy: generated.by, editedAt: encodeAt(generated.at) }
			: {};
	return { integrity: "drifted", drift: { reason: "content-changed", ...edited } };
};

const signal = Effect.fn("Trust.signal")(function* (concept: LoadedConcept, config: OkfitConfig, now: DateTime.Utc) {
	const tier = Derive.trustTier(concept.frontmatter);
	const stale = Derive.isStale(concept.frontmatter, now);
	const input = inputOf(concept, config);
	const content = needsDigest(input)
		? yield* Derivation.contentDigest(concept.frontmatter.raw, concept.document.source)
		: undefined;
	return { tier, stale, ...evaluate(input, content) } satisfies ConceptSignal;
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
	if (drift.reason === "actor-not-allowed") {
		return `verified by ${binding?.by ?? by}, who is not in [actors].humans; a listed human re-runs okfit verify`;
	}
	const edited = drift.editedBy === undefined ? "" : ` (edited by ${drift.editedBy} at ${drift.editedAt})`;
	return `content changed since ${binding?.by ?? by} verified it at ${binding === undefined ? at : encodeAt(binding.at)}${edited}; re-run okfit verify`;
};

/**
 * Where a `verified-drift` finding points (spec section 6): the binding when one exists,
 * else the latest human `verified` entry -- by its list index when `verified` is a
 * sequence, the key itself when it is a single bare mapping.
 */
const rangePath = (concept: LoadedConcept): ReadonlyArray<string | number> => {
	if (concept.frontmatter.integrity?.verified !== undefined) return ["integrity", "verified"];
	const latest = latestHuman(concept);
	const index = latest === undefined ? -1 : (concept.frontmatter.verified ?? []).indexOf(latest);
	return Array.isArray(concept.frontmatter.raw.verified) && index >= 0 ? ["verified", index] : ["verified"];
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
		// `okfit verify` refuses drafts and deprecated concepts, so a warning on one could never be cleared.
		const status = Derive.status(concept.frontmatter);
		if (status === "draft" || status === "deprecated") continue;
		const result = given?.get(id) ?? (yield* signal(concept, config, now));
		if (result.drift === undefined) continue;
		const range = DiagnosticRange.forFrontmatterPath(concept.document, rangePath(concept));
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
	) => Effect.Effect<ConceptSignal, PlatformError.PlatformError, Crypto.Crypto> = signal;
	/** The signal for every concept in a bundle, keyed by concept id. */
	static readonly signals: (
		bundle: LoadedBundle,
		config: OkfitConfig,
		now: DateTime.Utc,
	) => Effect.Effect<Map<string, ConceptSignal>, PlatformError.PlatformError, Crypto.Crypto> = signals;
	/** Pure integrity decision; no hashing. `content` may be `undefined` only when {@link Trust.needsDigest} is false. */
	static readonly evaluate: (
		input: EvaluateInput,
		content: string | undefined,
	) => { readonly integrity: IntegrityState; readonly drift?: NonNullable<ConceptSignal["drift"]> } = evaluate;
	/** True iff the latest human entry is bound by `integrity.verified` and its actor passes the allow-list, i.e. a digest is needed. */
	static readonly needsDigest: (input: EvaluateInput) => boolean = needsDigest;
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
	) => Effect.Effect<Array<Diagnostic>, PlatformError.PlatformError, Crypto.Crypto> = lint;
}
