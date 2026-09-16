import { OKF_SPEC_VERSION } from "@okfit/core";
import { GraphEnvelope, graphEnvelope, jsonError, provideConfig, resolveProjectConfig, runGraph } from "@okfit/engine";
import { Console, Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { Distribution } from "../internal/distribution.js";
import { setExitCode } from "../internal/exit.js";
import { CLI_VERSION } from "../version.js";

/** `[path]` is the PROJECT root (K-2), never the bundle root. Absolute at parse time (K-50). */
const pathArg = Argument.Path("path", { pathType: "directory" }).pipe(
	Argument.optional,
	Argument.withDescription(
		"project root to start config discovery from (default: current directory); never the bundle root",
	),
);

/** K-1: no `mustExist` — the handler stats the path itself, before building any layer. */
const configFlag = Flag.File("config").pipe(
	Flag.optional,
	Flag.withDescription("explicit config file; skips discovery"),
);

/** Default `mermaid`, unlike every other command's `--format` (which defaults `human`). */
const formatFlag = Flag.Literals("format", ["mermaid", "dot", "json"] as const).pipe(
	Flag.withDefault("mermaid"),
	Flag.withDescription("output format: mermaid (default), dot, or json"),
);

/**
 * `okfit graph [path] [--config <file>] [--format mermaid|dot|json]`.
 *
 * Same handler skeleton as `commands/validate.ts`/`commands/context.ts` —
 * stat `--config` (K-1) via `provideConfig`, resolve the project and
 * bundle roots through `resolveProjectConfig` — then it diverges:
 * `@okfit/engine`'s `runGraph` (`Bundle.load` then `Graph.fromBundle`),
 * render, and always exit `0`. `mermaid`/`dot` print the graph's own
 * `toMermaid()`/`toGraphViz()` text raw to stdout — nothing else on
 * stdout, no summary line — since either is meant to be piped straight
 * into a renderer. Only `--format json` failures get the K-22 `jsonError`
 * envelope; a `mermaid`/`dot` failure renders the usual way through
 * `bin.ts`'s `CliRuntime.reportFailures` and carries no stdout envelope.
 *
 * @public
 */
export const graphCommand = Command.make("graph", { path: pathArg, config: configFlag, format: formatFlag }, (input) =>
	Effect.gen(function* () {
		const cwd = process.cwd();
		const discoveryCwd = Option.getOrElse(input.path, () => cwd);
		const distribution = yield* Distribution;

		const body = Effect.gen(function* () {
			const resolved = yield* resolveProjectConfig({
				pathArg: input.path,
				explicitConfigPath: input.config,
				cwd,
			});
			const { bundleRoot, config: merged, profile } = resolved;

			const result = yield* runGraph({ root: bundleRoot });

			if (input.format === "json") {
				const envelope = graphEnvelope({
					okfitVersion: CLI_VERSION,
					producer: "okfit",
					okfVersion: merged.okf_version ?? OKF_SPEC_VERSION,
					root: bundleRoot,
					profile: Option.match(profile, { onNone: () => null, onSome: (p) => p.name }),
					nodes: result.graph.nodes,
					edges: result.graph.edges,
					// exactOptionalPropertyTypes: omit the key rather than set it to undefined.
					...(Option.isSome(distribution) ? { distribution: distribution.value } : {}),
				});
				yield* Console.log(JSON.stringify(Schema.encodeSync(GraphEnvelope)(envelope)));
			} else if (input.format === "dot") {
				yield* Console.log(result.graph.toGraphViz());
			} else {
				yield* Console.log(result.graph.toMermaid());
			}

			setExitCode(0);
		}).pipe(provideConfig({ explicitConfigPath: input.config, discoveryCwd }));

		// K-22: under --format json, an infrastructure failure ALSO gets a stdout
		// envelope; mermaid/dot failures do not — they render the usual way only.
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
		"Render the bundle's link graph: frontmatter path fields and body links, as Mermaid, DOT, or JSON.",
	),
);
