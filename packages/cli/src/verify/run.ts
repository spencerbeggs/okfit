import { MarkdownEdit } from "@effected/markdown";
import type { OkfitConfig } from "@okfit/core";
import { Bundle, ConceptId, Timestamp } from "@okfit/core";
import { VerifyConceptNotFoundError, VerifyUnsupportedFrontmatterError } from "@okfit/engine";
import { Derivation } from "@okfit/profiles";
import type { DateTime } from "effect";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
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
	/** The exact bytes {@link splice}'s edit would insert, written or not. */
	readonly fragment: string;
}

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
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;

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

	// Steps 9 and 10. The splice reads the file itself rather than anything
	// MarkdownDocument retained: the write path stays independent of the load
	// path for one syscall.
	const absolutePath = path.join(bundle.root, concept.path);
	const source = yield* fs.readFileString(absolutePath);
	const { text, bom } = stripBom(source);

	// Step 11 (V-14): fail closed, file untouched. Run unconditionally — a
	// dry run must fail on an unsupported shape exactly like a real run would
	// (I3): there is no cheaper preview path that skips classification.
	const located = yield* locate(text);
	if (located._tag === "unsupported") {
		return yield* new VerifyUnsupportedFrontmatterError({ id, shape: located.shape });
	}

	// Step 12. Both values are already strings; neither is ever re-stringified
	// by a YAML serialiser.
	const at = Schema.encodeSync(Timestamp)(options.at);

	// Step 13 (V-2): prior entries by THIS actor, in list order, for the human
	// renderer only. The splice never re-encodes this value.
	const priorAt = (concept.frontmatter.verified ?? [])
		.filter((entry) => entry.by === actor)
		.map((entry) => Schema.encodeSync(Timestamp)(entry.at));

	// Steps 14 and 15. The edit itself is computed unconditionally (I3): a
	// dry run reports the exact fragment it would write, so it runs the same
	// splice a real run does, not a shortcut that stops before the edit
	// exists.
	const edit = splice(located, { by: actor, at }, documentNewline(text));
	const finalText = bom + MarkdownEdit.applyAll(text, [edit]);

	if (!options.dryRun) {
		// I4: resolve the concept's REAL path first. `absolutePath` may be a
		// symlink; a temp-and-rename through it would replace the link itself
		// with a regular file and leave the link's target untouched.
		// Resolving first means the temp file sits beside the real target and
		// the rename replaces the real target, so the symlink survives.
		const target = yield* fs.realPath(absolutePath);
		const tempPath = `${target}.okfit-verify.tmp`;

		// Minor 1: preserve the target's mode on the temp file rather than
		// leaving it at whatever `writeFileString` defaults to (the process
		// umask), which would silently widen a `chmod`-restricted concept.
		const original = yield* fs.stat(target);
		yield* fs.writeFileString(tempPath, finalText);
		yield* fs.chmod(tempPath, original.mode);

		// V-16: a temp file beside the target, then a rename over it. NOT
		// `makeTempFile` — that defaults to an OS temp directory, and a
		// cross-device rename is not atomic. A PlatformError from any of
		// these calls renders through the catch-all at exit 3 (K-46).
		// Minor 2: a failed rename leaves no litter behind — remove the temp
		// file, best effort, without masking the original failure.
		yield* fs
			.rename(tempPath, target)
			.pipe(Effect.onError(() => fs.remove(tempPath, { force: true }).pipe(Effect.ignore)));
	}

	return {
		id,
		bundleRoot: bundle.root,
		conceptPath: concept.path,
		by: actor,
		at,
		priorAt,
		dryRun: options.dryRun,
		fragment: edit.content,
	} satisfies VerifyResult;
});
