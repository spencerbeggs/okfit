import { CurrentDistribution } from "@effected/engine";
import type { LoadedBundle, OkfitConfig } from "@okfit/core";
import { Bundle } from "@okfit/core";
import type { ConceptFilter, Distribution, QueryLink } from "@okfit/engine";
import {
	ConceptQuery,
	QueryGetEnvelope,
	QueryListEnvelope,
	QueryNeighborsEnvelope,
	QuerySelectionError,
	jsonError,
	provideConfig,
	queryGetEnvelope,
	queryListEnvelope,
	queryNeighborsEnvelope,
	resolveProjectConfig,
	toConceptSummary,
} from "@okfit/engine";
import { Console, Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { setExitCode } from "../internal/exit.js";
import { displayRoot } from "../render/human.js";
import { humanQueryGet, humanQueryList, humanQueryNeighbors, queryListSummary } from "../render/query.js";
import { CLI_VERSION } from "../version.js";

/** `[path]` is the PROJECT root (K-2), never the bundle root. Absolute at parse time (K-50). */
const pathArg = Argument.Path("path", { pathType: "directory" }).pipe(
	Argument.optional,
	Argument.withDescription(
		"project root to start config discovery from (default: current directory); never the bundle root",
	),
);

const idArg = Argument.String("id").pipe(
	Argument.withDescription("concept id, with or without a leading slash or trailing .md"),
);

/** K-1: no `mustExist` — the handler stats the path itself, before building any layer. */
const configFlag = Flag.File("config").pipe(
	Flag.optional,
	Flag.withDescription("explicit config file; skips discovery"),
);

const formatFlag = Flag.Literals("format", ["human", "json"] as const).pipe(
	Flag.withDefault("human"),
	Flag.withDescription("output format: human (default) or json"),
);

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
	Flag.withDescription("only concepts with at least one verified entry"),
);

const unverifiedFlag = Flag.Boolean("unverified").pipe(
	Flag.withDefault(false),
	Flag.withDescription("only concepts with no verified entry"),
);

/**
 * Shared skeleton: discover config, load the bundle, run `use`, and — under
 * `--format json` — apply the K-22 stdout error envelope.
 */
const run = <A, E, R>(
	input: {
		readonly path: Option.Option<string>;
		readonly config: Option.Option<string>;
		readonly format: "human" | "json";
	},
	use: (ctx: {
		readonly bundle: LoadedBundle;
		readonly config: OkfitConfig;
		readonly root: string;
		readonly distribution: Option.Option<Distribution>;
	}) => Effect.Effect<A, E, R>,
	pre?: Effect.Effect<void, QuerySelectionError>,
) =>
	Effect.gen(function* () {
		const cwd = process.cwd();
		const discoveryCwd = Option.getOrElse(input.path, () => cwd);
		const path = yield* Path.Path;
		const distribution = yield* CurrentDistribution;

		const body = Effect.gen(function* () {
			if (pre !== undefined) yield* pre;
			const resolved = yield* resolveProjectConfig({
				pathArg: input.path,
				explicitConfigPath: input.config,
				cwd,
			});
			const bundle = yield* Bundle.load({ root: resolved.bundleRoot });
			yield* use({
				bundle,
				config: resolved.config,
				root: displayRoot(cwd, resolved.bundleRoot, path),
				distribution,
			});
			setExitCode(0);
		}).pipe(provideConfig({ explicitConfigPath: input.config, discoveryCwd }));

		// K-22: under --format json, an infrastructure failure ALSO gets a stdout envelope.
		if (input.format === "json") {
			return yield* body.pipe(
				Effect.tapError((error) =>
					Console.log(JSON.stringify(jsonError(error, CLI_VERSION, Option.getOrUndefined(distribution)))),
				),
			);
		}
		return yield* body;
	});

const distributionOf = (distribution: Option.Option<Distribution>) =>
	Option.isSome(distribution) ? { distribution: distribution.value } : {};

/**
 * `okfit query list [path] [--type <T>]... [--tag <t>]... [--status <s>]...
 * [--verified|--unverified] [--config <file>] [--format human|json]`.
 *
 * @public
 */
export const queryListCommand = Command.make(
	"list",
	{
		path: pathArg,
		config: configFlag,
		type: typeFlag,
		tag: tagFlag,
		status: statusFlag,
		verified: verifiedFlag,
		unverified: unverifiedFlag,
		format: formatFlag,
	},
	(input) => {
		const filter: ConceptFilter = {
			...(input.type.length > 0 ? { types: input.type } : {}),
			...(input.tag.length > 0 ? { tags: input.tag } : {}),
			...(input.status.length > 0 ? { statuses: input.status } : {}),
			...(input.verified ? { verified: true } : {}),
			...(input.unverified ? { verified: false } : {}),
		};
		return run(
			input,
			({ bundle, config, root, distribution }) =>
				Effect.gen(function* () {
					const concepts = yield* ConceptQuery.list(bundle, config, filter);
					const items = concepts.map(toConceptSummary);
					if (input.format === "json") {
						const envelope = queryListEnvelope({
							okfitVersion: CLI_VERSION,
							total: items.length,
							items,
							...distributionOf(distribution),
						});
						yield* Console.log(JSON.stringify(Schema.encodeSync(QueryListEnvelope)(envelope)));
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
	Command.withDescription("List concepts, sorted by id, optionally filtered by type, tag, status, or verified state."),
);

/**
 * `okfit query get <id> [path] [--config <file>] [--format human|json]`.
 *
 * @public
 */
export const queryGetCommand = Command.make(
	"get",
	{ id: idArg, path: pathArg, config: configFlag, format: formatFlag },
	(input) =>
		run(input, ({ bundle, distribution }) =>
			Effect.gen(function* () {
				const { concept, links } = yield* ConceptQuery.get(bundle, input.id);
				const summary = toConceptSummary(concept);
				const queryLinks: ReadonlyArray<QueryLink> = links;
				if (input.format === "json") {
					const envelope = queryGetEnvelope({
						okfitVersion: CLI_VERSION,
						concept: summary,
						frontmatter: concept.frontmatter as Readonly<Record<string, unknown>>,
						links: queryLinks,
						...distributionOf(distribution),
					});
					yield* Console.log(JSON.stringify(Schema.encodeSync(QueryGetEnvelope)(envelope)));
				} else {
					for (const line of humanQueryGet({
						summary,
						verified: concept.frontmatter.verified ?? [],
						links: queryLinks,
					})) {
						yield* Console.log(line);
					}
				}
			}),
		),
).pipe(Command.withDescription("Show one concept: its fields, verified entries, and outgoing links."));

/**
 * `okfit query neighbors <id> [path] [--config <file>] [--format human|json]`.
 *
 * @public
 */
export const queryNeighborsCommand = Command.make(
	"neighbors",
	{ id: idArg, path: pathArg, config: configFlag, format: formatFlag },
	(input) =>
		run(input, ({ bundle, distribution }) =>
			Effect.gen(function* () {
				const result = yield* ConceptQuery.neighbors(bundle, input.id);
				const project = (n: (typeof result.outgoing)[number]) => ({
					id: n.id,
					kind: n.kind,
					summary: n.concept === null ? null : toConceptSummary(n.concept),
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
					yield* Console.log(JSON.stringify(Schema.encodeSync(QueryNeighborsEnvelope)(envelope)));
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
