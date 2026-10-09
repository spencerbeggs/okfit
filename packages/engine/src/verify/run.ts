import { MarkdownEdit } from "@effected/markdown";
import type { Actor, LoadedBundle, LoadedConcept, OkfitConfig, Status } from "@okfit/core";
import { Bundle, ConceptId, Derive, Timestamp } from "@okfit/core";
import { Derivation } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Option, Path, Schema } from "effect";
import { VerifyConceptNotFoundError, VerifyUnsupportedFrontmatterError } from "../errors.js";
import { documentNewline, locate, locateTopLevelScalar, locateVerifiedAt, stripBom } from "./locate.js";
import type { PickerCandidate, VerifyBatchSkipReason } from "./select.js";
import { resolveBatchTypes, selectAttestable, selectPickerCandidates, selectStaleCandidates } from "./select.js";
import { orderVerifyEdits, splice, spliceTopLevelScalar } from "./splice.js";

/**
 * The only four diagnostic codes that can co-occur with a MISSING
 * `concepts` entry (V-9, contract §12 note 10): `Bundle.ts:143/164/175/186`
 * emit the three frontmatter codes and return without a concept, and
 * `internal/frontmatter.ts:73` emits `type-missing` for `decodeConcept`'s
 * only failure branch. Every other code — `family-invalid`,
 * `computation-runtime-missing`, `legacy-timestamp` — is pushed as an issue
 * while `decodeConcept` still returns a concept, so the concept IS in the
 * map (`internal/conceptDecode.ts:84-134`).
 */
const UNDECODABLE_CODES: ReadonlySet<string> = new Set([
	"frontmatter-unparseable",
	"frontmatter-unclosed",
	"frontmatter-missing",
	"type-missing",
]);

/** @internal */
export interface VerifyOptions {
	readonly id: string;
	/** Absolute bundle root, from `resolveProjectConfig`. */
	readonly bundleRoot: string;
	/** Absolute project root — V-7 spells `generatedBy`'s cwd as exactly this. */
	readonly projectRoot: string;
	/** Already merged `DEFAULTS < profile < file` by the caller (D-28). */
	readonly config: OkfitConfig;
	/** `--at` when given, else the `Now` service (K-47/K-49). */
	readonly at: DateTime.Utc;
	readonly dryRun: boolean;
	/** Issue #185: also set the concept's `status` in the same write. */
	readonly status?: "stable" | "draft";
}

/** @internal */
export interface VerifyResult {
	readonly id: string;
	/** Absolute bundle root, echoed back for `displayRoot`. */
	readonly bundleRoot: string;
	/** Posix bundle-relative path with `.md`, straight off `LoadedConcept.path`. */
	readonly conceptPath: string;
	/** The branded actor string, e.g. `human:spencer`. */
	readonly by: string;
	/** The `Timestamp`-encoded ISO string actually recorded. */
	readonly at: string;
	/** Every PRIOR entry by this same actor, in list order, encoded (V-2). */
	readonly priorAt: ReadonlyArray<string>;
	readonly dryRun: boolean;
	/** The exact bytes `splice`'s edit would insert, written or not. */
	readonly fragment: string;
	/** `null` when no status flag was given; `from` is the RAW frontmatter status. */
	readonly status: { readonly from: Status | null; readonly to: "stable" | "draft" } | null;
	/** The exact status bytes spliced, or `null` when no status edit was made. */
	readonly statusFragment: string | null;
}

/**
 * Issue #138: options for {@link runVerifyBatch}. `types` restricts the
 * selected concept types; empty selects every type whose `config.types`
 * declaration sets `require_verified = true`.
 *
 * @public
 */
export interface VerifyBatchOptions {
	readonly bundleRoot: string;
	readonly projectRoot: string;
	readonly config: OkfitConfig;
	readonly at: DateTime.Utc;
	readonly dryRun: boolean;
	/** Restrict to these types; empty = every type with `require_verified = true`. */
	readonly types: ReadonlyArray<string>;
}

export type { VerifyBatchSkipReason } from "./select.js";

/**
 * The result of {@link runVerifyBatch}.
 *
 * @public
 */
export interface VerifyBatchResult {
	readonly bundleRoot: string;
	readonly by: string;
	readonly at: string;
	readonly dryRun: boolean;
	/** In bundle iteration order; each carries the exact fragment written (or that would be). */
	readonly verified: ReadonlyArray<{ readonly id: string; readonly conceptPath: string; readonly fragment: string }>;
	readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: VerifyBatchSkipReason }>;
}

interface PreparedVerify {
	readonly absolutePath: string;
	readonly finalText: string;
	readonly fragment: string;
	readonly statusFragment: string | null;
	readonly priorAt: ReadonlyArray<string>;
}

/** Steps 9-14 of runVerify: read, locate (fail closed), splice; no write. */
const prepareVerify = Effect.fn("okfit/verify/prepareVerify")(function* (
	bundle: LoadedBundle,
	concept: LoadedConcept,
	actor: Actor,
	at: string,
	status: "stable" | "draft" | undefined,
	// Issue #228: the encoded new `stale_after`; set only by `runVerifyIds`'
	// `refreshStaleAfter`. Also switches a re-attestation to overwrite the
	// actor's existing entry's `at` rather than append a second entry.
	staleAfter: string | undefined = undefined,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const absolutePath = path.join(bundle.root, concept.path);
	// `readFileString` decodes with a BOM-stripping `TextDecoder`, which would
	// make `stripBom` a no-op and silently drop the BOM on write-back.
	const source = new TextDecoder("utf-8", { ignoreBOM: true }).decode(yield* fs.readFile(absolutePath));
	const { text, bom } = stripBom(source);
	const located = yield* locate(text);
	if (located._tag === "unsupported") {
		return yield* new VerifyUnsupportedFrontmatterError({ id: concept.id, shape: located.shape, key: "verified" });
	}
	const priorAt = (concept.frontmatter.verified ?? [])
		.filter((entry) => entry.by === actor)
		.map((entry) => Schema.encodeSync(Timestamp)(entry.at));
	const newline = documentNewline(text);
	let verifiedEdit = splice(located, { by: actor, at }, newline);
	if (staleAfter !== undefined && priorAt.length > 0) {
		const existing = yield* locateVerifiedAt(text, actor);
		if (existing._tag === "replaceScalar") {
			const quoted =
				existing.quote === "single-quoted" ? `'${at}'` : existing.quote === "double-quoted" ? `"${at}"` : at;
			verifiedEdit = MarkdownEdit.make({
				offset: existing.start,
				length: existing.end - existing.start,
				content: quoted,
			});
		}
	}
	let statusEdit: MarkdownEdit | undefined;
	// A concept already at the target makes no edit, so an unsupported `status`
	// shape on it is deliberately never located: there is nothing to fail on.
	if (status !== undefined && concept.frontmatter.status !== status) {
		const target = yield* locateTopLevelScalar(text, "status");
		if (target._tag === "unsupported") {
			return yield* new VerifyUnsupportedFrontmatterError({ id: concept.id, shape: target.shape, key: "status" });
		}
		statusEdit = spliceTopLevelScalar(target, "status", status, newline);
	}
	let staleEdit: MarkdownEdit | undefined;
	// Only a concept that already carries `stale_after` is rolled forward; one
	// without is never given a clock it did not have.
	if (staleAfter !== undefined && concept.frontmatter.stale_after !== undefined) {
		const target = yield* locateTopLevelScalar(text, "stale_after");
		if (target._tag !== "replaceScalar") {
			return yield* new VerifyUnsupportedFrontmatterError({
				id: concept.id,
				shape: target._tag === "unsupported" ? target.shape : "stale_after-absent",
				key: "stale_after",
			});
		}
		staleEdit = spliceTopLevelScalar(target, "stale_after", staleAfter, newline);
	}
	const ordered = orderVerifyEdits(verifiedEdit, statusEdit);
	const edits = staleEdit === undefined ? ordered : [...ordered, staleEdit].toSorted((a, b) => a.offset - b.offset);
	return {
		absolutePath,
		finalText: bom + MarkdownEdit.applyAll(text, edits),
		fragment: verifiedEdit.content,
		statusFragment: statusEdit?.content ?? null,
		priorAt,
	} satisfies PreparedVerify;
});

/** The I4/V-16 atomic write: real path, temp beside it, mode preserved, rename. */
const writeVerified = Effect.fn("okfit/verify/writeVerified")(function* (absolutePath: string, finalText: string) {
	const fs = yield* FileSystem.FileSystem;
	const target = yield* fs.realPath(absolutePath);
	const tempPath = `${target}.okfit-verify.tmp`;
	const original = yield* fs.stat(target);
	yield* fs.writeFileString(tempPath, finalText);
	yield* fs.chmod(tempPath, original.mode);
	yield* fs
		.rename(tempPath, target)
		.pipe(Effect.onError(() => fs.remove(tempPath, { force: true }).pipe(Effect.ignore)));
});

/** Steps 7a-7d of runVerify, shared with `runVerifyIds`: tolerant id, reserved file, located concept. */
const resolveConcept = (bundle: LoadedBundle, rawId: string) =>
	Effect.gen(function* () {
		// Step 7a: tolerant id, the MCP tools' own convention.
		const normalized = ConceptId.normalize(rawId);
		if (Option.isNone(normalized)) {
			return yield* new VerifyConceptNotFoundError({ id: rawId, root: bundle.root, reason: "not-a-concept" });
		}
		const id = normalized.value;
		const conceptFile = ConceptId.toPath(id);

		// Step 7b.
		if (ConceptId.isReservedFile(conceptFile)) {
			return yield* new VerifyConceptNotFoundError({ id, root: bundle.root, reason: "reserved" });
		}

		// Steps 7c and 7d.
		const concept = bundle.concepts.get(id);
		if (concept === undefined) {
			const diagnostic = bundle.diagnostics.find(
				(entry) => entry.file === conceptFile && UNDECODABLE_CODES.has(entry.code),
			);
			return yield* new VerifyConceptNotFoundError({
				id,
				root: bundle.root,
				...(diagnostic === undefined
					? { reason: "not-a-concept" as const }
					: { reason: "undecodable" as const, diagnosticCode: diagnostic.code }),
			});
		}
		return { id, concept };
	});

/**
 * Contract §2.3 steps 6–15. Loads the bundle, resolves the id, resolves the
 * human actor from git, splices exactly one entry into the concept's
 * frontmatter and writes it back atomically.
 *
 * Nothing here reads `stale_after` or a type's `require_verified`; `status`
 * is read only to skip a no-op edit under `options.status` (#185). `verify`
 * is mechanical, not config-aware (V-4, V-5).
 *
 * @internal
 */
export const runVerify = Effect.fn("okfit/verify/runVerify")(function* (options: VerifyOptions) {
	// Step 6 (V-10): Bundle.load only — no validate pass, no single-concept
	// core path. Its diagnostics feed the `undecodable` reason below.
	const bundle = yield* Bundle.load({ root: options.bundleRoot });

	// Steps 7a-7d: tolerant id, reserved files, undecodable concepts.
	const { id, concept } = yield* resolveConcept(bundle, options.id);

	// Step 8 (V-7, V-18): once per process, always the git identity, no --by.
	const actor = yield* Derivation.generatedBy({
		writer: "human",
		cwd: options.projectRoot,
		config: options.config,
	});

	// Step 12. Both values are already strings; neither is ever re-stringified
	// by a YAML serialiser.
	const at = Schema.encodeSync(Timestamp)(options.at);

	// Steps 9-14: read, locate (fail closed, V-14), splice. Run
	// unconditionally — a dry run must fail on an unsupported shape exactly
	// like a real run would (I3): there is no cheaper preview path that skips
	// classification, and the edit itself is computed unconditionally so a
	// dry run reports the exact fragment it would write.
	const prepared = yield* prepareVerify(bundle, concept, actor, at, options.status);

	// Step 15 (I4/V-16): a temp file beside the real target, then a rename
	// over it, mode preserved -- see `writeVerified`'s own comments.
	if (!options.dryRun) yield* writeVerified(prepared.absolutePath, prepared.finalText);

	return {
		id,
		bundleRoot: bundle.root,
		conceptPath: concept.path,
		by: actor,
		at,
		priorAt: prepared.priorAt,
		dryRun: options.dryRun,
		fragment: prepared.fragment,
		status: options.status === undefined ? null : { from: concept.frontmatter.status ?? null, to: options.status },
		statusFragment: prepared.statusFragment,
	} satisfies VerifyResult;
});

/**
 * Issue #138. Attests every concept selected by `options.types` (or, when
 * empty, every type whose declaration sets `require_verified = true`) that
 * is not a draft, is not deprecated (#143) and does not already carry a `verified` entry by the
 * resolved actor. Every candidate is located FIRST -- an unsupported
 * `verified` shape on any one of them fails the whole batch with nothing
 * written, mirroring `runVerify`'s own fail-closed rule at batch scale.
 *
 * @public
 */
export const runVerifyBatch = Effect.fn("okfit/verify/runVerifyBatch")(function* (options: VerifyBatchOptions) {
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const types = yield* resolveBatchTypes(options.config, options.types);

	const actor = yield* Derivation.generatedBy({ writer: "human", cwd: options.projectRoot, config: options.config });
	const at = Schema.encodeSync(Timestamp)(options.at);

	const selection = selectAttestable(bundle, types, actor);
	const prepared: Array<{ readonly id: string; readonly conceptPath: string } & PreparedVerify> = [];
	// Every concept is located before any is written: one unsupported
	// shape fails the whole batch with the tree untouched.
	for (const concept of selection.candidates) {
		prepared.push({
			id: concept.id,
			conceptPath: concept.path,
			...(yield* prepareVerify(bundle, concept, actor, at, undefined)),
		});
	}

	if (!options.dryRun) {
		for (const entry of prepared) yield* writeVerified(entry.absolutePath, entry.finalText);
	}

	return {
		bundleRoot: bundle.root,
		by: actor,
		at,
		dryRun: options.dryRun,
		verified: prepared.map(({ id, conceptPath, fragment }) => ({ id, conceptPath, fragment })),
		skipped: selection.skipped,
	} satisfies VerifyBatchResult;
});

/**
 * Issue #214: options for {@link runVerifyIds}.
 *
 * @public
 */
export interface VerifyIdsOptions {
	readonly bundleRoot: string;
	readonly projectRoot: string;
	readonly config: OkfitConfig;
	readonly at: DateTime.Utc;
	readonly dryRun: boolean;
	/** Concept ids, resolved as `runVerify` resolves one (tolerant: leading slash, trailing `.md`). */
	readonly ids: ReadonlyArray<string>;
	/** Also set `status: stable` on every selected concept whose status is `draft`. Default `false`. */
	readonly promote?: boolean;
	/**
	 * Issue #228: also roll each selected concept's existing `stale_after`
	 * forward to `Derivation.staleAfter(at, config)` in the same write, and
	 * overwrite the actor's existing `verified` entry's `at` instead of
	 * appending a duplicate. A concept without `stale_after` gets none added.
	 * Default `false`: plain verify never touches `stale_after`.
	 */
	readonly refreshStaleAfter?: boolean;
}

/**
 * Issue #214. Attests an explicit list of concept ids in one all-or-nothing
 * batch. Every id is resolved exactly as {@link runVerify} resolves it, and
 * every concept is located and spliced BEFORE any file is written, so one
 * unknown id, reserved file or unsupported `verified`/`status` shape fails the
 * whole call with the tree untouched. An explicit pick is never second-guessed:
 * drafts, deprecated and already-attested concepts are all attested, and
 * `skipped` is always empty. Duplicate ids (after normalisation) are written
 * once. With `promote`, a draft's `status` becomes `stable` in the same write.
 *
 * @public
 */
export const runVerifyIds = Effect.fn("okfit/verify/runVerifyIds")(function* (options: VerifyIdsOptions) {
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const actor = yield* Derivation.generatedBy({ writer: "human", cwd: options.projectRoot, config: options.config });
	const at = Schema.encodeSync(Timestamp)(options.at);

	// Whole-second ISO with `Z`, matching how this repo writes `stale_after`.
	const staleAfter =
		options.refreshStaleAfter === true
			? Schema.encodeSync(Timestamp)(
					DateTime.makeUnsafe(
						Math.floor(DateTime.toEpochMillis(Derivation.staleAfter(options.at, options.config)) / 1000) * 1000,
					),
				)
			: undefined;

	const concepts = new Map<string, LoadedConcept>();
	for (const rawId of options.ids) {
		const { id, concept } = yield* resolveConcept(bundle, rawId);
		concepts.set(id, concept);
	}

	const prepared: Array<{ readonly id: string; readonly conceptPath: string } & PreparedVerify> = [];
	for (const [id, concept] of concepts) {
		const status = options.promote === true && concept.frontmatter.status === "draft" ? "stable" : undefined;
		prepared.push({
			id,
			conceptPath: concept.path,
			...(yield* prepareVerify(bundle, concept, actor, at, status, staleAfter)),
		});
	}

	if (!options.dryRun) {
		for (const entry of prepared) yield* writeVerified(entry.absolutePath, entry.finalText);
	}

	return {
		bundleRoot: bundle.root,
		by: actor,
		at,
		dryRun: options.dryRun,
		verified: prepared.map(({ id, conceptPath, fragment }) => ({ id, conceptPath, fragment })),
		skipped: [],
	} satisfies VerifyBatchResult;
});

/**
 * Options for {@link loadPickerCandidates}.
 *
 * @public
 */
export interface PickerCandidatesOptions {
	readonly bundleRoot: string;
	readonly projectRoot: string;
	readonly config: OkfitConfig;
}

/**
 * The interactive verify picker's starting point: loads the bundle, resolves
 * the human actor from git exactly as {@link runVerify} does, and selects the
 * rows that actor may still attest. Reads only; nothing is written.
 *
 * @public
 */
export const loadPickerCandidates = Effect.fn("okfit/verify/loadPickerCandidates")(function* (
	options: PickerCandidatesOptions,
) {
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const by = yield* Derivation.generatedBy({ writer: "human", cwd: options.projectRoot, config: options.config });
	return { by, candidates: selectPickerCandidates(bundle, options.config, by) } satisfies {
		readonly by: string;
		readonly candidates: ReadonlyArray<PickerCandidate>;
	};
});

/**
 * Issue #228: as {@link loadPickerCandidates}, but the rows are the concepts
 * stale at `now` (any type, the actor's own attestations included), for
 * `okfit stale --verify` to re-attest and roll forward. Reads only.
 *
 * @public
 */
export const loadStaleCandidates = Effect.fn("okfit/verify/loadStaleCandidates")(function* (
	options: PickerCandidatesOptions & { readonly now: DateTime.Utc },
) {
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const by = yield* Derivation.generatedBy({ writer: "human", cwd: options.projectRoot, config: options.config });
	return { by, candidates: selectStaleCandidates(bundle, Derive.staleReport(bundle, options.now), by) } satisfies {
		readonly by: string;
		readonly candidates: ReadonlyArray<PickerCandidate>;
	};
});
