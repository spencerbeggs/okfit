import { CliFormat, Doc } from "@effected/cli";
import { CurrentDistribution } from "@effected/engine";
import {
	MoveEnvelope,
	Now,
	jsonError,
	moveEnvelope,
	provideConfig,
	resolveProjectConfig,
	runMove,
} from "@okfit/engine";
import { Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { rootFlag } from "../internal/root.js";
import { displayRoot } from "../render/human.js";
import { humanMoveDoc } from "../render/move.js";
import { CLI_VERSION } from "../version.js";

const fromArg = Argument.String("from").pipe(Argument.withDescription("the concept to move: an id or a path"));

const toArg = Argument.String("to").pipe(
	Argument.withDescription("where to move it: an id or a path inside the bundle; .md is added when missing"),
);

/** K-1: no `mustExist`; the handler stats it via `provideConfig`. */
const configFlag = Flag.File("config").pipe(
	Flag.optional,
	Flag.withDescription("explicit config file; skips discovery"),
);

const dryRunFlag = Flag.Boolean("dry-run").pipe(
	Flag.withDefault(false),
	Flag.withDescription("print the plan; write nothing"),
);

const formatFlag = CliFormat.flag<"json", { readonly human: "auto" }>(["json"], {
	aliases: { human: "auto" },
	default: "human",
	description: "output format: human (default) or json",
});

/**
 * `okfit mv <from> <to> [--root <dir>] [--config <file>] [--dry-run] [--format human|json]`.
 *
 * @public
 */
export const mvCommand = Command.make(
	"mv",
	{ from: fromArg, to: toArg, root: rootFlag, config: configFlag, dryRun: dryRunFlag, format: formatFlag },
	(input) =>
		Effect.gen(function* () {
			const cwd = process.cwd();
			const discoveryCwd = Option.getOrElse(input.root, () => cwd);
			const distribution = yield* CurrentDistribution;

			const body = Effect.gen(function* () {
				const path = yield* Path.Path;
				const resolved = yield* resolveProjectConfig({
					pathArg: input.root,
					explicitConfigPath: input.config,
					cwd,
				});
				const now = yield* Now;
				const result = yield* runMove({
					from: input.from,
					to: input.to,
					cwd,
					bundleRoot: resolved.bundleRoot,
					config: resolved.config,
					now,
					dryRun: input.dryRun,
				});
				const { plan } = result;
				const from = plan.from.slice(0, -3);
				const to = plan.to.slice(0, -3);
				if (input.format === "json") {
					const envelope = moveEnvelope({
						okfitVersion: CLI_VERSION,
						from: plan.from,
						to: plan.to,
						path: `${displayRoot(cwd, result.bundleRoot, path)}/${plan.to}`,
						dryRun: result.dryRun,
						edits: plan.edits.map(({ path: editPath, count }) => ({ path: editPath, count })),
						drifts: plan.drifts,
						// exactOptionalPropertyTypes: omit the key rather than set it to undefined.
						...(Option.isSome(distribution) ? { distribution: distribution.value } : {}),
					});
					yield* CliFormat.printJson(Schema.encodeSync(MoveEnvelope)(envelope), { indent: 0 });
				} else {
					yield* Doc.print(humanMoveDoc({ from, to, edits: plan.edits, drifts: plan.drifts, dryRun: result.dryRun }));
				}
			}).pipe(provideConfig({ explicitConfigPath: input.config, discoveryCwd }));

			// K-22: under --format json an infrastructure failure ALSO gets a stdout envelope.
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
		"Move a concept to a new path and rewrite every reference to it across the bundle (body links, path fields, " +
			"supersedes, Publication renders). Every rewritten file drifts and needs a human to re-verify it; " +
			"run okfit sync afterwards to regenerate index.md and the generated stamps.",
	),
);
