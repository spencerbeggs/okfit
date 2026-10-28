import { CliFormat } from "@effected/cli";
import { CurrentDistribution } from "@effected/engine";
import type { LoadedBundle, OkfitConfig } from "@okfit/core";
import { Bundle } from "@okfit/core";
import type { ConceptFilter, Distribution } from "@okfit/engine";
import {
	ConceptQuery,
	Now,
	QueryGetEnvelope,
	QueryListEnvelope,
	QueryNeighborsEnvelope,
	QuerySelectionError,
	Targets,
	jsonError,
	provideConfig,
	queryGetEnvelope,
	queryListEnvelope,
	queryNeighborsEnvelope,
	resolveProjectConfig,
	signalFor,
	toConceptSummary,
	toTrustDrift,
} from "@okfit/engine";
import type { ConceptSignal } from "@okfit/profiles";
import { Trust } from "@okfit/profiles";
import { Console, Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { rootFlag } from "../internal/root.js";
import { displayRoot } from "../render/human.js";
import { humanQueryGet, humanQueryList, humanQueryNeighbors, queryListSummary } from "../render/query.js";
import { CLI_VERSION } from "../version.js";

const idArg = Argument.String("target").pipe(
	Argument.withDescription("concept: an id (leading / and trailing .md tolerated) or a path to its file"),
);

const targetsArg = Argument.String("targets").pipe(
	Argument.variadic({ min: 1 }),
	Argument.withDescription("one or more concepts: ids or paths to concept files"),
);

/** K-1: no `mustExist` — the handler stats the path itself, before building any layer. */
const configFlag = Flag.File("config").pipe(
	Flag.optional,
	Flag.withDescription("explicit config file; skips discovery"),
);

const formatFlag = CliFormat.flag<"json", { readonly human: "auto" }>(["json"], {
	aliases: { human: "auto" },
	default: "human",
	description: "output format: human (default) or json",
});

const typeFlag = Flag.String("type").pipe(
	Flag.atLeast(0),
	Flag.withDescription("only concepts of this type (repeatable; any match)"),
);

const tagFlag = Flag.String("tag").pipe(
	Flag.atLeast(0),
	Flag.withDescription("only concepts carrying this tag (repeatable; all must match)"),
);

const statusFlag = Flag.Literals("status", ["draft", "stable", "deprecated"] as const).pipe(
	Flag.atLeast(0),
	Flag.withDescription("only concepts with this status (repeatable; any match)"),
);

const verifiedFlag = Flag.Boolean("verified").pipe(
	Flag.withDefault(false),
	Flag.withDescription("only concepts whose latest human verification is current"),
);

const unverifiedFlag = Flag.Boolean("unverified").pipe(
	Flag.withDefault(false),
	Flag.withDescription("only concepts with no verification (tier unverified)"),
);

const driftedFlag = Flag.Boolean("drifted").pipe(
	Flag.withDefault(false),
	Flag.withDescription("only concepts whose human verification no longer matches their content"),
);

const staleFlag = Flag.Boolean("stale").pipe(
	Flag.withDefault(false),
	Flag.withDescription("only concepts whose stale_after has passed"),
);

/**
 * Shared skeleton: discover config, load the bundle, run `use`, and — under
 * `--format json` — apply the K-22 stdout error envelope. `precheck` runs
 * first, before any config discovery, so an invalid flag combination fails fast.
 */
const run = <A, E, R>(
	input: {
		readonly root: Option.Option<string>;
		readonly config: Option.Option<string>;
		readonly format: "auto" | "json";
	},
	use: (ctx: {
		readonly bundle: LoadedBundle;
		readonly config: OkfitConfig;
		readonly root: string;
		readonly distribution: Option.Option<Distribution>;
		readonly signals: ReadonlyMap<string, ConceptSignal>;
	}) => Effect.Effect<A, E, R>,
	precheck?: Effect.Effect<void, QuerySelectionError>,
) =>
	Effect.gen(function* () {
		const cwd = process.cwd();
		const discoveryCwd = Option.getOrElse(input.root, () => cwd);
		const path = yield* Path.Path;
		const distribution = yield* CurrentDistribution;

		const body = Effect.gen(function* () {
			if (precheck !== undefined) yield* precheck;
			const resolved = yield* resolveProjectConfig({
				pathArg: input.root,
				explicitConfigPath: input.config,
				cwd,
			});
			const bundle = yield* Bundle.load({ root: resolved.bundleRoot });
			const now = yield* Now;
			const signals = yield* Trust.signals(bundle, resolved.config, now);
			yield* use({
				signals,
				bundle,
				config: resolved.config,
				root: displayRoot(cwd, resolved.bundleRoot, path),
				distribution,
			});
		}).pipe(provideConfig({ explicitConfigPath: input.config, discoveryCwd }));

		// K-22: under --format json, an infrastructure failure ALSO gets a stdout envelope.
		if (input.format === "json") {
			return yield* body.pipe(
				Effect.tapError((error) =>
					CliFormat.printJson(jsonError(error, CLI_VERSION, Option.getOrUndefined(distribution)), { indent: 0 }),
				),
			);
		}
		return yield* body;
	});

const distributionOf = (distribution: Option.Option<Distribution>) =>
	Option.isSome(distribution) ? { distribution: distribution.value } : {};

/**
 * `okfit query list [--root <dir>] [--type <T>]... [--tag <t>]... [--status <s>]...
 * [--verified|--unverified] [--drifted] [--stale] [--config <file>] [--format human|json]`.
 *
 * @public
 */
export const queryListCommand = Command.make(
	"list",
	{
		root: rootFlag,
		config: configFlag,
		type: typeFlag,
		tag: tagFlag,
		status: statusFlag,
		verified: verifiedFlag,
		unverified: unverifiedFlag,
		drifted: driftedFlag,
		stale: staleFlag,
		format: formatFlag,
	},
	(input) => {
		const filter: ConceptFilter = {
			...(input.type.length > 0 ? { types: input.type } : {}),
			...(input.tag.length > 0 ? { tags: input.tag } : {}),
			...(input.status.length > 0 ? { statuses: input.status } : {}),
			...(input.verified ? { verified: "current" as const } : {}),
			...(input.unverified ? { verified: "unverified" as const } : {}),
			...(input.drifted ? { drifted: true } : {}),
			...(input.stale ? { stale: true } : {}),
		};
		return run(
			input,
			({ bundle, config, root, distribution, signals }) =>
				Effect.gen(function* () {
					const concepts = yield* ConceptQuery.list(bundle, config, filter, signals);
					const items = concepts.map((c) => toConceptSummary(c, signalFor(signals, c.id)));
					if (input.format === "json") {
						const envelope = queryListEnvelope({
							okfitVersion: CLI_VERSION,
							total: items.length,
							items,
							...distributionOf(distribution),
						});
						yield* CliFormat.printJson(Schema.encodeSync(QueryListEnvelope)(envelope), { indent: 0 });
					} else {
						for (const line of humanQueryList(items)) yield* Console.log(line);
						yield* Console.error(queryListSummary(items.length, root));
					}
				}),
			input.verified && input.unverified
				? Effect.fail(new QuerySelectionError({ reason: "verified-conflict" }))
				: undefined,
		);
	},
).pipe(
	Command.withDescription("List concepts, sorted by id, optionally filtered by type, tag, status, or trust signal."),
);

/**
 * `okfit query get <targets...> [--root <dir>] [--config <file>] [--format human|json]`.
 *
 * @public
 */
export const queryGetCommand = Command.make(
	"get",
	{ targets: targetsArg, root: rootFlag, config: configFlag, format: formatFlag },
	(input) =>
		run(input, ({ bundle, distribution, signals }) =>
			Effect.gen(function* () {
				const resolved = yield* Targets.resolve(input.targets, bundle, process.cwd());
				const found = [];
				for (const target of resolved) found.push(yield* ConceptQuery.get(bundle, target.id as string));
				const views = found.map(({ concept, links }) => {
					const signal = signalFor(signals, concept.id);
					return { concept, links, signal, summary: toConceptSummary(concept, signal) };
				});
				if (input.format === "json") {
					const encoded = views.map(({ concept, links, signal, summary }) =>
						Schema.encodeSync(QueryGetEnvelope)(
							queryGetEnvelope({
								okfitVersion: CLI_VERSION,
								concept: summary,
								drift: toTrustDrift(signal),
								frontmatter: concept.frontmatter.raw,
								links,
								...distributionOf(distribution),
							}),
						),
					);
					yield* CliFormat.printJson(encoded.length === 1 ? encoded[0] : encoded, { indent: 0 });
				} else {
					let first = true;
					for (const { concept, links, signal, summary } of views) {
						if (!first) yield* Console.log("");
						first = false;
						for (const line of humanQueryGet({
							summary,
							drift: toTrustDrift(signal),
							verified: concept.frontmatter.verified ?? [],
							links,
						})) {
							yield* Console.log(line);
						}
					}
				}
			}),
		),
).pipe(Command.withDescription("Show one or more concepts: their fields, verified entries, and outgoing links."));

/**
 * `okfit query neighbors <target> [--root <dir>] [--config <file>] [--format human|json]`.
 *
 * @public
 */
export const queryNeighborsCommand = Command.make(
	"neighbors",
	{ id: idArg, root: rootFlag, config: configFlag, format: formatFlag },
	(input) =>
		run(input, ({ bundle, distribution, signals }) =>
			Effect.gen(function* () {
				const [target] = yield* Targets.resolve([input.id], bundle, process.cwd());
				const result = yield* ConceptQuery.neighbors(bundle, (target as { id: string }).id);
				const project = (n: (typeof result.outgoing)[number]) => ({
					id: n.id,
					kind: n.kind,
					summary: n.concept === null ? null : toConceptSummary(n.concept, signalFor(signals, n.concept.id)),
				});
				const outgoing = result.outgoing.map(project);
				const incoming = result.incoming.map(project);
				if (input.format === "json") {
					const envelope = queryNeighborsEnvelope({
						okfitVersion: CLI_VERSION,
						id: result.id,
						outgoing,
						incoming,
						...distributionOf(distribution),
					});
					yield* CliFormat.printJson(Schema.encodeSync(QueryNeighborsEnvelope)(envelope), { indent: 0 });
				} else {
					for (const line of humanQueryNeighbors({ outgoing, incoming })) yield* Console.log(line);
				}
			}),
		),
).pipe(Command.withDescription("Show the concepts a concept links to and the ones that link to it."));

/**
 * `okfit query`: read-only questions about the bundle, one subcommand per
 * MCP query tool (`list_concepts`, `get_concept`, `concept_neighbors`) over
 * the same `@okfit/engine` `ConceptQuery`. No handler: bare `okfit query`
 * prints help and exits 0, the root command's own K-5 behaviour.
 *
 * @public
 */
export const queryCommand = Command.make("query", {}).pipe(
	Command.withDescription("Read-only queries over the bundle: list, get, neighbors."),
	Command.withSubcommands([queryListCommand, queryGetCommand, queryNeighborsCommand]),
);
