import { CliFormat, CliInteractive, Doc } from "@effected/cli";
import { CurrentDistribution } from "@effected/engine";
import { Git } from "@effected/git";
import { Bundle, Timestamp } from "@okfit/core";
import {
	Now,
	RevokeEnvelope,
	Targets,
	VerifyBatchEnvelope,
	VerifyEnvelope,
	VerifySelectionError,
	jsonError,
	provideConfig,
	resolveProjectConfig,
	revokeEnvelope,
	runRevoke,
	runRevokeIds,
	runVerify,
	runVerifyBatch,
	runVerifyIds,
	verifyBatchEnvelope,
	verifyEnvelope,
} from "@okfit/engine";
import { Console, DateTime, Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { rootFlag } from "../internal/root.js";
import { displayRoot } from "../render/human.js";
import { humanRevokeDoc, humanVerifyBatchDoc, humanVerifyDoc } from "../render/verify.js";
import { CLI_VERSION } from "../version.js";
import { confirmReverify } from "./verify-confirm.js";
import { pickConcepts } from "./verify-picker.js";

/** Concept targets: ids, cwd-relative paths or absolute paths, mixed (spec section 13). */
const targetsArg = Argument.String("targets").pipe(
	Argument.variadic({ min: 0 }),
	Argument.withDescription(
		"concepts to verify: ids (leading / and trailing .md tolerated), or paths to concept files; omit with --all or --type",
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

/** Issue #185: settle the concept in the same write as the attestation. */
const stableFlag = Flag.Boolean("stable").pipe(
	Flag.withDefault(false),
	Flag.withDescription("also set status: stable in the same write; needs one concept target"),
);

/** Issue #185: record a review without settling. */
const draftFlag = Flag.Boolean("draft").pipe(
	Flag.withDefault(false),
	Flag.withDescription("also set (or keep) status: draft in the same write; needs a concept id"),
);

/** Take back your own verification of one concept. */
const revokeFlag = Flag.Boolean("revoke").pipe(
	Flag.withDefault(false),
	Flag.withDescription(
		"remove your own verified entries from the concept (and its integrity binding); needs concept targets, excludes --all, --type, --stable, --draft and --at",
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

/** Skip the interactive "what changed" patch and re-verify prompt for a drifted concept. */
const noDiffFlag = Flag.Boolean("no-diff").pipe(
	Flag.withDefault(false),
	Flag.withDescription(
		"do not show what changed or ask before re-verifying a drifted concept; the interactive prompt is the only thing this turns off",
	),
);

const formatFlag = CliFormat.flag<"json", { readonly human: "auto" }>(["json"], {
	aliases: { human: "auto" },
	default: "human",
	description: "output format: human (default) or json",
});

/**
 * `okfit verify [<target>...] [--root <dir>] [--all] [--type <Type>]... [--stable|--draft]
 * [--revoke] [--config <file>] [--at <iso>] [--dry-run] [--no-diff] [--format human|json]`.
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
		targets: targetsArg,
		root: rootFlag,
		config: configFlag,
		all: allFlag,
		type: typeFlag,
		stable: stableFlag,
		draft: draftFlag,
		revoke: revokeFlag,
		at: atFlag,
		dryRun: dryRunFlag,
		noDiff: noDiffFlag,
		format: formatFlag,
	},
	(input) =>
		Effect.gen(function* () {
			const cwd = process.cwd();

			const batch = input.all || input.type.length > 0;
			const discoveryCwd = Option.getOrElse(input.root, () => cwd);
			const distribution = yield* CurrentDistribution;

			const body = Effect.gen(function* () {
				// --revoke is its own mode: validate its usage before touching config, git or the clock.
				if (input.revoke) {
					const conflicts = [
						...(input.all ? ["--all"] : []),
						...(input.type.length > 0 ? ["--type"] : []),
						...(input.stable ? ["--stable"] : []),
						...(input.draft ? ["--draft"] : []),
						...(Option.isSome(input.at) ? ["--at"] : []),
					];
					if (conflicts.length > 0) {
						return yield* new VerifySelectionError({ reason: "revoke-conflict", detail: conflicts.join(", ") });
					}
					if (input.targets.length === 0) return yield* new VerifySelectionError({ reason: "revoke-needs-id" });
				}
				// Issue #138: targets or --all/--type, never both; checked before config is touched.
				if (input.targets.length > 0 && batch) {
					return yield* new VerifySelectionError({ reason: "targets-and-batch" });
				}
				if (input.stable && input.draft) return yield* new VerifySelectionError({ reason: "status-conflict" });
				if ((input.stable || input.draft) && input.targets.length !== 1) {
					return yield* new VerifySelectionError({ reason: "status-and-batch" });
				}
				const path = yield* Path.Path;
				const resolved = yield* resolveProjectConfig({
					pathArg: input.root,
					explicitConfigPath: input.config,
					cwd,
				});

				// Every target resolves before anything runs; any bad one fails them all (exit 64).
				let ids: ReadonlyArray<string> = [];
				if (input.targets.length > 0) {
					const bundle = yield* Bundle.load({ root: resolved.bundleRoot });
					const targets = yield* Targets.resolve(input.targets, bundle, cwd);
					ids = targets.map((target) => target.id as string);
				}

				if (input.revoke) {
					const revokeOptions = {
						bundleRoot: resolved.bundleRoot,
						projectRoot: resolved.projectRoot,
						config: resolved.config,
						dryRun: input.dryRun,
					};
					const results =
						ids.length === 1
							? [yield* runRevoke({ id: ids[0] as string, ...revokeOptions })]
							: yield* runRevokeIds({ ids, ...revokeOptions });
					const envelopes = results.map((result) =>
						Schema.encodeSync(RevokeEnvelope)(
							revokeEnvelope({
								okfitVersion: CLI_VERSION,
								id: result.id,
								path: `${displayRoot(cwd, result.bundleRoot, path)}/${result.conceptPath}`,
								by: result.by,
								removed: result.removed,
								bindingCleared: result.bindingCleared,
								dryRun: result.dryRun,
								// exactOptionalPropertyTypes: omit the key rather than set it to undefined.
								...(Option.isSome(distribution) ? { distribution: distribution.value } : {}),
							}),
						),
					);
					if (input.format === "json") {
						// R2: one target keeps the bare object; several are an array of the same envelopes.
						yield* CliFormat.printJson(envelopes.length === 1 ? envelopes[0] : envelopes, { indent: 0 });
					} else {
						for (const result of results) {
							yield* Doc.print(
								humanRevokeDoc({
									id: result.id,
									by: result.by,
									removed: result.removed,
									bindingCleared: result.bindingCleared,
									dryRun: result.dryRun,
								}),
							);
						}
					}
					return;
				}

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

				const status = input.stable ? "stable" : input.draft ? "draft" : undefined;

				// Bare `verify`: pick interactively. Without `otherwise`, a run that
				// cannot mount a screen (agent/ci audience, pipe, --format json)
				// fails `NotInteractive`, which is the 64 below, not a prompt.
				if (ids.length === 0 && !batch) {
					// Decide before touching the bundle, so a non-interactive run is a
					// plain 64 whatever state the bundle or git identity is in.
					if (!(yield* CliInteractive)) return yield* new VerifySelectionError({ reason: "no-selection" });
					const picked = yield* pickConcepts({
						bundleRoot: resolved.bundleRoot,
						projectRoot: resolved.projectRoot,
						config: resolved.config,
					}).pipe(
						Effect.catchTag("NotInteractive", () => Effect.fail(new VerifySelectionError({ reason: "no-selection" }))),
					);
					if (picked === undefined) return;
					const result = yield* runVerifyIds({
						bundleRoot: resolved.bundleRoot,
						projectRoot: resolved.projectRoot,
						config: resolved.config,
						at,
						dryRun: input.dryRun,
						ids: picked.ids,
						promote: picked.promote,
					});
					// --format json never reaches here: it makes the run non-interactive.
					yield* Doc.print(
						humanVerifyBatchDoc({
							by: result.by,
							at: result.at,
							dryRun: result.dryRun,
							verified: result.verified,
							skipped: result.skipped,
						}),
					);
					return;
				}

				if (batch || ids.length > 1) {
					const result =
						ids.length > 1
							? yield* runVerifyIds({
									bundleRoot: resolved.bundleRoot,
									projectRoot: resolved.projectRoot,
									config: resolved.config,
									at,
									dryRun: input.dryRun,
									ids,
								})
							: yield* runVerifyBatch({
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
						yield* CliFormat.printJson(Schema.encodeSync(VerifyBatchEnvelope)(envelope), { indent: 0 });
					} else {
						yield* Doc.print(
							humanVerifyBatchDoc({
								by: result.by,
								at: result.at,
								dryRun: result.dryRun,
								verified: result.verified,
								skipped: result.skipped,
							}),
						);
					}
					return;
				}

				// Exactly one target is left here (R1): today's single-concept path.
				const [singleId] = ids;
				if (singleId === undefined) return yield* new VerifySelectionError({ reason: "no-selection" });

				// A drifted concept on a terminal: show what changed and ask first.
				// Declining is exit 0 with nothing written.
				const proceed = yield* confirmReverify({
					id: singleId,
					bundleRoot: resolved.bundleRoot,
					projectRoot: resolved.projectRoot,
					config: resolved.config,
					now: at,
					noDiff: input.noDiff,
					dryRun: input.dryRun,
				});
				if (!proceed) {
					yield* Console.log(`not re-verified: ${singleId}; nothing written`);
					return;
				}

				const result = yield* runVerify({
					id: singleId,
					bundleRoot: resolved.bundleRoot,
					projectRoot: resolved.projectRoot,
					config: resolved.config,
					at,
					dryRun: input.dryRun,
					...(status === undefined ? {} : { status }),
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
						status: result.status,
						priorIntegrity: result.priorDrift,
						// exactOptionalPropertyTypes: omit the key rather than set it to undefined.
						...(Option.isSome(distribution) ? { distribution: distribution.value } : {}),
					});
					yield* CliFormat.printJson(Schema.encodeSync(VerifyEnvelope)(envelope), { indent: 0 });
				} else {
					yield* Doc.print(
						humanVerifyDoc({
							id: result.id,
							by: result.by,
							at: result.at,
							priorAt: result.priorAt,
							dryRun: result.dryRun,
							fragment: result.fragment,
							status: result.status,
							statusFragment: result.statusFragment,
							priorDrift: result.priorDrift,
						}),
					);
				}
			}).pipe(
				// Contract §12 note 8: `Derivation.generatedBy` requires `Git`, and
				// no other okfit CLI file provides it. `Git.layer` needs
				// `ChildProcessSpawner`, which `bin.ts`'s `NodeServices.layer`
				// already supplies, so this is the whole fix.
				Effect.provide(Git.layer),
				provideConfig({ explicitConfigPath: input.config, discoveryCwd }),
				// #217: machine output never prompts. Narrows only, so `--format
				// human` keeps whatever the audience and terminal decided.
				CliInteractive.unless(input.format === "json"),
			);

			// K-22: under --format json an infrastructure failure ALSO gets a
			// stdout envelope, reusing @okfit/engine's render/json.ts#jsonError unchanged — the
			// third copy of an idiom already in validate.ts and context.ts.
			if (input.format === "json") {
				return yield* body.pipe(
					Effect.tapError((error) =>
						CliFormat.printJson(jsonError(error, CLI_VERSION, Option.getOrUndefined(distribution)), { indent: 0 }),
					),
				);
			}
			return yield* body;
		}),
).pipe(
	Command.withDescription(
		"Record a human's attestation that a concept has been reviewed: append one verified entry, " +
			"{ by: human:<id>, at: <now> }, to its frontmatter. The actor is always your own git identity; " +
			"there is no --by. Give one or more concept targets (ids or paths), or --all/--type <Type> (repeatable) to attest a batch of " +
			"unverified concepts at once; exactly one of the two selections is required. " +
			"With exactly one target, --stable or --draft also sets its status in the same write. " +
			"--revoke <target>... takes back your own attestation: it removes your verified entries and the integrity binding. " +
			"This is a human-run command: no agent, hook, or MCP tool ever invokes it.",
	),
);
