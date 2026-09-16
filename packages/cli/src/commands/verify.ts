import { Git } from "@effected/git";
import { Timestamp } from "@okfit/core";
import {
	Now,
	VerifyBatchEnvelope,
	VerifyEnvelope,
	VerifySelectionError,
	jsonError,
	provideConfig,
	resolveProjectConfig,
	runVerify,
	runVerifyBatch,
	verifyBatchEnvelope,
	verifyEnvelope,
} from "@okfit/engine";
import { Console, DateTime, Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { Distribution } from "../internal/distribution.js";
import { setExitCode } from "../internal/exit.js";
import { displayRoot } from "../render/human.js";
import { humanVerify, humanVerifyBatch } from "../render/verify.js";
import { CLI_VERSION } from "../version.js";

/**
 * V-6: tolerant id, normalised through `ConceptId.normalize`; never
 * `Argument.Path`. Issue #138 makes it optional: `--all`/`--type` select a
 * batch instead of a single concept.
 */
const idArg = Argument.String("id").pipe(
	Argument.optional,
	Argument.withDescription(
		"concept id to verify, with or without a leading slash or trailing .md; omit with --all or --type",
	),
);

/** Issue #138: attest every unverified concept whose type sets `require_verified`. */
const allFlag = Flag.Boolean("all").pipe(
	Flag.withDefault(false),
	Flag.withDescription(
		"verify every concept whose type sets require_verified and that you have not verified yet; drafts are skipped",
	),
);

/** Issue #138: narrow (or, without --all, define) the batch to these types. */
const typeFlag = Flag.String("type").pipe(
	Flag.atLeast(0),
	Flag.withDescription(
		"verify every unverified concept of this type (repeatable); implies --all's selection rule for the named types",
	),
);

/** K-2: `[path]` is the PROJECT root, byte-identical to validate/init/context's. */
const pathArg = Argument.Path("path", { pathType: "directory" }).pipe(
	Argument.optional,
	Argument.withDescription(
		"project root to start config discovery from (default: current directory); never the bundle root",
	),
);

/** K-1: no `mustExist`; the handler stats it via `provideConfig`. */
const configFlag = Flag.File("config").pipe(
	Flag.optional,
	Flag.withDescription("explicit config file; skips discovery"),
);

/** V-6: `Flag.String`, decoded through core's `Timestamp` — never `Flag.Date`, which yields a bare Date. */
const atFlag = Flag.String("at").pipe(
	Flag.optional,
	Flag.withDescription("ISO 8601 timestamp with an explicit offset to record instead of now"),
);

/** V-6/V-8: the preview is a flag, never a prompt. */
const dryRunFlag = Flag.Boolean("dry-run").pipe(
	Flag.withDefault(false),
	Flag.withDescription("print the exact fragment a real run would splice in; write nothing"),
);

const formatFlag = Flag.Literals("format", ["human", "json"] as const).pipe(
	Flag.withDefault("human"),
	Flag.withDescription("output format: human (default) or json"),
);

/**
 * `okfit verify [<id>] [path] [--all] [--type <Type>]... [--config <file>]
 * [--at <iso>] [--dry-run] [--format human|json]`.
 *
 * Handler order fixed by contract §2.3. Steps 1–3 are `context`'s handler
 * in substance — stat `--config` (K-1) via `provideConfig`, discover,
 * resolve the profile and roots through `resolveProjectConfig` — then it
 * diverges: resolve `at` (the `Now` service, or `--at` through
 * `Schema.decodeUnknownEffect(Timestamp)`, never the throwing sync
 * decoder), provide `Git` for `Derivation.generatedBy`, run the splice and
 * the atomic write, render, and always exit `0`. There is no content tier:
 * every typed failure is exit `3` through `bin.ts`'s existing
 * `reportFailures`.
 *
 * @public
 */
export const verifyCommand = Command.make(
	"verify",
	{
		id: idArg,
		path: pathArg,
		config: configFlag,
		all: allFlag,
		type: typeFlag,
		at: atFlag,
		dryRun: dryRunFlag,
		format: formatFlag,
	},
	(input) =>
		Effect.gen(function* () {
			const cwd = process.cwd();

			// Issue #138/final-review F2: `id` and `path` are both optional
			// positionals bound in declaration order, so `okfit verify --all
			// /abs/project` lands the path in `id`. An id is meaningless in
			// batch mode, so when only one positional is given under
			// --all/--type, treat that token as the project root; only fail
			// `id-and-batch` below when BOTH positionals are present.
			const batch = input.all || input.type.length > 0;
			const idIsPath = batch && Option.isSome(input.id) && Option.isNone(input.path);
			const effectivePath = idIsPath ? input.id : input.path;

			const discoveryCwd = Option.getOrElse(effectivePath, () => cwd);
			const distribution = yield* Distribution;

			const body = Effect.gen(function* () {
				const path = yield* Path.Path;
				const resolved = yield* resolveProjectConfig({
					pathArg: effectivePath,
					explicitConfigPath: input.config,
					cwd,
				});

				// Contract §12 note 7: decodeUnknownSync THROWS, and a throw inside
				// Effect.gen is a defect, not an exit-3 failure. The
				// Effect-returning decoder is mandatory here. The clock's own
				// value carries milliseconds; truncate it to whole seconds so a
				// recorded attestation matches every documented example
				// (README, cli-commands.md). `--at` is never truncated — it is
				// recorded exactly as the caller gave it.
				const at = Option.isNone(input.at)
					? DateTime.startOf(yield* Now, "second")
					: yield* Schema.decodeUnknownEffect(Timestamp)(input.at.value);

				// Issue #138: exactly one of `id` or `--all`/`--type` selects. A
				// lone `id` token under batch mode was already reinterpreted as
				// `effectivePath` above (F2), so `id-and-batch` only fires when
				// BOTH positionals are present alongside a batch selector.
				if (Option.isSome(input.id) && Option.isSome(input.path) && batch) {
					return yield* new VerifySelectionError({ reason: "id-and-batch" });
				}
				if (Option.isNone(input.id) && !batch) return yield* new VerifySelectionError({ reason: "no-selection" });

				if (batch) {
					const result = yield* runVerifyBatch({
						bundleRoot: resolved.bundleRoot,
						projectRoot: resolved.projectRoot,
						config: resolved.config,
						at,
						dryRun: input.dryRun,
						types: input.type,
					});
					const root = displayRoot(cwd, result.bundleRoot, path);
					if (input.format === "json") {
						const envelope = verifyBatchEnvelope({
							okfitVersion: CLI_VERSION,
							by: result.by,
							at: result.at,
							concepts: result.verified.map((entry) => ({ id: entry.id, path: `${root}/${entry.conceptPath}` })),
							skipped: result.skipped,
							dryRun: result.dryRun,
							// exactOptionalPropertyTypes: omit the key rather than set it to undefined.
							...(Option.isSome(distribution) ? { distribution: distribution.value } : {}),
						});
						yield* Console.log(JSON.stringify(Schema.encodeSync(VerifyBatchEnvelope)(envelope)));
					} else {
						for (const line of humanVerifyBatch({
							by: result.by,
							at: result.at,
							dryRun: result.dryRun,
							verified: result.verified,
							skipped: result.skipped,
						})) {
							yield* Console.log(line);
						}
					}
					setExitCode(0);
					return;
				}

				// The two guard clauses above already rule out `id-and-batch` and
				// `no-selection`, so `input.id` is Some here; this repeats the
				// check purely so TypeScript narrows it.
				if (Option.isNone(input.id)) return yield* new VerifySelectionError({ reason: "no-selection" });

				const result = yield* runVerify({
					id: input.id.value,
					bundleRoot: resolved.bundleRoot,
					projectRoot: resolved.projectRoot,
					config: resolved.config,
					at,
					dryRun: input.dryRun,
				});

				const displayPath = `${displayRoot(cwd, result.bundleRoot, path)}/${result.conceptPath}`;

				if (input.format === "json") {
					const envelope = verifyEnvelope({
						okfitVersion: CLI_VERSION,
						id: result.id,
						path: displayPath,
						by: result.by,
						at: result.at,
						dryRun: result.dryRun,
						// exactOptionalPropertyTypes: omit the key rather than set it to undefined.
						...(Option.isSome(distribution) ? { distribution: distribution.value } : {}),
					});
					yield* Console.log(JSON.stringify(Schema.encodeSync(VerifyEnvelope)(envelope)));
				} else {
					for (const line of humanVerify({
						id: result.id,
						by: result.by,
						at: result.at,
						priorAt: result.priorAt,
						dryRun: result.dryRun,
						fragment: result.fragment,
					})) {
						yield* Console.log(line);
					}
				}

				setExitCode(0);
			}).pipe(
				// Contract §12 note 8: `Derivation.generatedBy` requires `Git`, and
				// no other okfit CLI file provides it. `Git.layer` needs
				// `ChildProcessSpawner`, which `bin.ts`'s `NodeServices.layer`
				// already supplies, so this is the whole fix.
				Effect.provide(Git.layer),
				provideConfig({ explicitConfigPath: input.config, discoveryCwd }),
			);

			// K-22: under --format json an infrastructure failure ALSO gets a
			// stdout envelope, reusing @okfit/engine's render/json.ts#jsonError unchanged — the
			// third copy of an idiom already in validate.ts and context.ts.
			if (input.format === "json") {
				return yield* body.pipe(
					Effect.tapError((error) =>
						Console.log(JSON.stringify(jsonError(error, CLI_VERSION, Option.getOrUndefined(distribution)))),
					),
				);
			}
			return yield* body;
		}),
).pipe(
	Command.withDescription(
		"Record a human's attestation that a concept has been reviewed: append one verified entry, " +
			"{ by: human:<id>, at: <now> }, to its frontmatter. The actor is always your own git identity; " +
			"there is no --by. Give a concept id, or --all/--type <Type> (repeatable) to attest a batch of " +
			"unverified concepts at once; exactly one of the two selections is required. " +
			"This is a human-run command: no agent, hook, or MCP tool ever invokes it.",
	),
);
