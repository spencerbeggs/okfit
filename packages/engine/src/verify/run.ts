import { MarkdownEdit } from "@effected/markdown";
import type { Actor, LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Bundle, ConceptId, Timestamp } from "@okfit/core";
import { Derivation } from "@okfit/profiles";
import type { DateTime } from "effect";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { VerifyConceptNotFoundError, VerifySelectionError, VerifyUnsupportedFrontmatterError } from "../errors.js";
import { documentNewline, locate, stripBom } from "./locate.js";
import { splice } from "./splice.js";

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

/**
 * Why {@link runVerifyBatch} skipped a candidate concept: `"draft"` for
 * `status === "draft"`, `"already-verified"` when the resolved actor already
 * carries a `verified` entry.
 *
 * @public
 */
export type VerifyBatchSkipReason = "draft" | "already-verified";

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
	readonly priorAt: ReadonlyArray<string>;
}

/** Steps 9-14 of runVerify: read, locate (fail closed), splice; no write. */
const prepareVerify = Effect.fn("okfit/verify/prepareVerify")(function* (
	bundle: LoadedBundle,
	concept: LoadedConcept,
	actor: Actor,
	at: string,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const absolutePath = path.join(bundle.root, concept.path);
	const source = yield* fs.readFileString(absolutePath);
	const { text, bom } = stripBom(source);
	const located = yield* locate(text);
	if (located._tag === "unsupported") {
		return yield* new VerifyUnsupportedFrontmatterError({ id: concept.id, shape: located.shape });
	}
	const priorAt = (concept.frontmatter.verified ?? [])
		.filter((entry) => entry.by === actor)
		.map((entry) => Schema.encodeSync(Timestamp)(entry.at));
	const edit = splice(located, { by: actor, at }, documentNewline(text));
	return {
		absolutePath,
		finalText: bom + MarkdownEdit.applyAll(text, [edit]),
		fragment: edit.content,
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

/**
 * Contract §2.3 steps 6–15. Loads the bundle, resolves the id, resolves the
 * human actor from git, splices exactly one entry into the concept's
 * frontmatter and writes it back atomically.
 *
 * Nothing here reads `status`, `stale_after`, or a type's
 * `require_verified`: `verify` is mechanical, not config-aware (V-4, V-5).
 *
 * @internal
 */
export const runVerify = Effect.fn("okfit/verify/runVerify")(function* (options: VerifyOptions) {
	// Step 6 (V-10): Bundle.load only — no validate pass, no single-concept
	// core path. Its diagnostics feed the `undecodable` reason below.
	const bundle = yield* Bundle.load({ root: options.bundleRoot });

	// Step 7a: tolerant id, the MCP tools' own convention.
	const normalized = ConceptId.normalize(options.id);
	if (Option.isNone(normalized)) {
		return yield* new VerifyConceptNotFoundError({
			id: options.id,
			root: bundle.root,
			reason: "not-a-concept",
		});
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
	const prepared = yield* prepareVerify(bundle, concept, actor, at);

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
	} satisfies VerifyResult;
});

/**
 * Issue #138. Attests every concept selected by `options.types` (or, when
 * empty, every type whose declaration sets `require_verified = true`) that
 * is not a draft and does not already carry a `verified` entry by the
 * resolved actor. Every candidate is located FIRST -- an unsupported
 * `verified` shape on any one of them fails the whole batch with nothing
 * written, mirroring `runVerify`'s own fail-closed rule at batch scale.
 *
 * @public
 */
export const runVerifyBatch = Effect.fn("okfit/verify/runVerifyBatch")(function* (options: VerifyBatchOptions) {
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const declared = options.config.types ?? {};

	let types: ReadonlySet<string>;
	if (options.types.length > 0) {
		for (const type of options.types) {
			if (!Object.hasOwn(declared, type))
				return yield* new VerifySelectionError({ reason: "unknown-type", detail: type });
		}
		types = new Set(options.types);
	} else {
		types = new Set(Object.entries(declared).flatMap(([name, spec]) => (spec.require_verified === true ? [name] : [])));
	}

	const actor = yield* Derivation.generatedBy({ writer: "human", cwd: options.projectRoot, config: options.config });
	const at = Schema.encodeSync(Timestamp)(options.at);

	const skipped: Array<{ readonly id: string; readonly reason: VerifyBatchSkipReason }> = [];
	const prepared: Array<{ readonly id: string; readonly conceptPath: string } & PreparedVerify> = [];
	for (const [id, concept] of bundle.concepts) {
		if (!types.has(concept.frontmatter.type)) continue;
		if (concept.frontmatter.status === "draft") {
			skipped.push({ id, reason: "draft" });
			continue;
		}
		if ((concept.frontmatter.verified ?? []).some((entry) => entry.by === actor)) {
			skipped.push({ id, reason: "already-verified" });
			continue;
		}
		// Every concept is located before any is written: one unsupported
		// shape fails the whole batch with the tree untouched.
		prepared.push({ id, conceptPath: concept.path, ...(yield* prepareVerify(bundle, concept, actor, at)) });
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
		skipped,
	} satisfies VerifyBatchResult;
});
