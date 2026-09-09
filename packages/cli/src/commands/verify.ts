import { Git } from "@effected/git";
import { Timestamp } from "@okfit/core";
import { Now, provideConfig, resolveProjectConfig } from "@okfit/engine";
import { Console, DateTime, Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { setExitCode } from "../internal/exit.js";
import { displayRoot } from "../render/human.js";
import { jsonError } from "../render/json.js";
import { VerifyEnvelope, humanVerify, verifyEnvelope } from "../render/verify.js";
import { runVerify } from "../verify/run.js";
import { CLI_VERSION } from "../version.js";

/** V-6: tolerant id, normalised through `ConceptId.normalize`; never `Argument.path`. */
const idArg = Argument.string("id").pipe(
	Argument.withDescription("concept id to verify, with or without a leading slash or trailing .md"),
);

/** K-2: `[path]` is the PROJECT root, byte-identical to validate/init/context's. */
const pathArg = Argument.path("path", { pathType: "directory" }).pipe(
	Argument.optional,
	Argument.withDescription(
		"project root to start config discovery from (default: current directory); never the bundle root",
	),
);

/** K-1: no `mustExist`; the handler stats it via `provideConfig`. */
const configFlag = Flag.file("config").pipe(
	Flag.optional,
	Flag.withDescription("explicit config file; skips discovery"),
);

/** V-6: `Flag.string`, decoded through core's `Timestamp` — never `Flag.date`, which yields a bare Date. */
const atFlag = Flag.string("at").pipe(
	Flag.optional,
	Flag.withDescription("ISO 8601 timestamp with an explicit offset to record instead of now"),
);

/** V-6/V-8: the preview is a flag, never a prompt. */
const dryRunFlag = Flag.boolean("dry-run").pipe(
	Flag.withDefault(false),
	Flag.withDescription("print the exact fragment a real run would splice in; write nothing"),
);

const formatFlag = Flag.choice("format", ["human", "json"] as const).pipe(
	Flag.withDefault("human"),
	Flag.withDescription("output format: human (default) or json"),
);

/**
 * `okfit verify <id> [path] [--config <file>] [--at <iso>] [--dry-run]
 * [--format human|json]`.
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
	{ id: idArg, path: pathArg, config: configFlag, at: atFlag, dryRun: dryRunFlag, format: formatFlag },
	(input) =>
		Effect.gen(function* () {
			const cwd = process.cwd();
			const discoveryCwd = Option.getOrElse(input.path, () => cwd);

			const body = Effect.gen(function* () {
				const path = yield* Path.Path;
				const resolved = yield* resolveProjectConfig({
					pathArg: input.path,
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

				const result = yield* runVerify({
					id: input.id,
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
			// stdout envelope, reusing render/json.ts#jsonError unchanged — the
			// third copy of an idiom already in validate.ts and context.ts.
			if (input.format === "json") {
				return yield* body.pipe(Effect.tapError((error) => Console.log(JSON.stringify(jsonError(error, CLI_VERSION)))));
			}
			return yield* body;
		}),
).pipe(
	Command.withDescription(
		"Record a human's attestation that a concept has been reviewed: append one verified entry, " +
			"{ by: human:<id>, at: <now> }, to its frontmatter. The actor is always your own git identity; " +
			"there is no --by. This is a human-run command: no agent, hook, or MCP tool ever invokes it.",
	),
);
