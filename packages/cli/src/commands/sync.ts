import { Git } from "@effected/git";
import type { SyncMode } from "@okfit/engine";
import { SyncEnvelope, jsonError, provideConfig, resolveProjectConfig, runSync, syncEnvelope } from "@okfit/engine";
import { GitHistory } from "@okfit/profiles";
import { Console, Effect, Layer, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { setExitCode } from "../internal/exit.js";
import { displayRoot } from "../render/human.js";
import { humanSync } from "../render/sync.js";
import { CLI_VERSION } from "../version.js";

/** K-2: `[path]` is the PROJECT root, byte-identical to validate/init/context/verify's. */
const pathArg = Argument.Path("path", { pathType: "directory" }).pipe(
	Argument.optional,
	Argument.withDescription("project root to start config discovery from (default: current directory)"),
);

/** K-1: no `mustExist` — the handler stats it via `provideConfig`. */
const configFlag = Flag.File("config").pipe(
	Flag.optional,
	Flag.withDescription("explicit config file; skips discovery"),
);

/**
 * S-13: a REPEATED `Flag.Literals`, not a comma-separated `Flag.String`.
 * `Flag.atLeast(0)` allows zero occurrences (all three modes run) up
 * through any number. Each occurrence is independently validated by the
 * underlying `Choice` primitive, so a bad token (`--only badmode`) is a
 * genuine parse-time `CliError.InvalidValue` → `ShowHelp` → `bin.ts`'s
 * existing 64 remap — no new error class, no hand-built `ShowHelp`
 * (contract §11, S-13, judge note 9).
 *
 * Note: `Flag.Literals`'s installed signature (`effect/unstable/cli/Flag.ts:169-172`)
 * takes `(name: string, literals: ReadonlyArray<string>)`, matching
 * `formatFlag` below — not the `[value, label]` tuple-pair form
 * `Flag.ChoiceWithValue` takes. The contract's own `onlyFlag` sketch
 * writes tuple pairs; since every pair's two elements are identical
 * (`["generated", "generated"]`, etc.), the plain string-array form
 * below is the same flag, verified against the installed primitive
 * rather than copied byte-for-byte from the contract's prose.
 */
const onlyFlag = Flag.Literals("only", ["generated", "index", "log"] as const).pipe(
	Flag.atLeast(0),
	Flag.withDescription(
		"restrict the run to these modes (repeatable: --only generated --only index); default: all three",
	),
);

const dryRunFlag = Flag.Boolean("dry-run").pipe(
	Flag.withDefault(false),
	Flag.withDescription("compute every result and write nothing"),
);

const formatFlag = Flag.Literals("format", ["human", "json"] as const).pipe(
	Flag.withDefault("human"),
	Flag.withDescription("output format: human (default) or json"),
);

/**
 * `okfit sync [path] [--config <file>] [--only <mode>]... [--dry-run]
 * [--format human|json]`.
 *
 * Handler order fixed by contract §4.3. Steps 1–3 are `context`'s/
 * `validate`'s handler in substance — stat `--config` (K-1) via
 * `provideConfig`, resolve the project and bundle roots through
 * `resolveProjectConfig` — then it diverges: build the `--only` mode
 * set (default: all three, order irrelevant — `runSync`'s own fixed
 * order wins, not `--only`'s occurrence order), run `runSync` with BOTH
 * `Git.layer` and `GitHistory.layer` provided (S-16, mirroring
 * `verify.ts:134`'s `Git.layer`-alone provision one layer up: here two
 * layers are needed because `GitHistory.layer` does not re-expose `Git`
 * even though it is built on it), render, and always exit `0`. There is
 * no content tier: every typed failure is exit `3` through `bin.ts`'s
 * existing `reportFailures`; an unknown `--only` token never reaches
 * this handler at all — it fails at parse time, exit `64`.
 *
 * @public
 */
export const syncCommand = Command.make(
	"sync",
	{ path: pathArg, config: configFlag, only: onlyFlag, dryRun: dryRunFlag, format: formatFlag },
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

				const modes: ReadonlySet<SyncMode> =
					input.only.length === 0 ? new Set<SyncMode>(["generated", "index", "log"]) : new Set(input.only);

				const result = yield* runSync({
					bundleRoot: resolved.bundleRoot,
					config: resolved.config,
					modes,
					dryRun: input.dryRun,
				}).pipe(Effect.provide(Layer.mergeAll(Git.layer, GitHistory.layer)));

				const displayPath = displayRoot(cwd, result.bundleRoot, path);

				if (input.format === "json") {
					const envelope = syncEnvelope({
						okfitVersion: CLI_VERSION,
						root: displayPath,
						dryRun: result.dryRun,
						result,
					});
					yield* Console.log(JSON.stringify(Schema.encodeSync(SyncEnvelope)(envelope)));
				} else {
					for (const line of humanSync(result)) {
						yield* Console.log(line);
					}
				}

				setExitCode(0);
			}).pipe(provideConfig({ explicitConfigPath: input.config, discoveryCwd }));

			// K-22: under --format json an infrastructure failure ALSO gets a
			// stdout envelope, reusing @okfit/engine's render/json.ts#jsonError unchanged — the
			// same idiom validate.ts, context.ts, and verify.ts already share.
			if (input.format === "json") {
				return yield* body.pipe(Effect.tapError((error) => Console.log(JSON.stringify(jsonError(error, CLI_VERSION)))));
			}
			return yield* body;
		}),
).pipe(
	Command.withDescription(
		"Regenerate the derived-content families that no other command produces: generated.at, index.md, and " +
			"log.md, all from git history and the bundle's own concepts. Mechanical and agent-runnable; never an " +
			"attestation and never touches verified.",
	),
);
