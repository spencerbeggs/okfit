import { contextEnvelope } from "@okfit/engine";
import { Effect, Option } from "effect";
import { Tool } from "effect/ai";
import { McpToolError } from "../errors.js";
import { resolveConfigOnly } from "../internal/toolContext.js";
import { DescribeVocabularySuccess } from "../schema/tools.js";

const DESCRIPTION =
	"Returns this project's resolved okfit configuration: project root, bundle root, active profile, agent actor, every concept type and tag the config declares, and docs_presets, the active profile's Surface templates (empty without a profile). Call this first, before filtering or writing any concept, to learn which names exist.";

/**
 * No `dependencies`: since Effect 4.1 a declared dependency becomes a
 * per-request `McpRequest<"Requires", S>` requirement. The platform services
 * the handler needs are captured once when `ToolsLayer` builds instead
 * (`toolkit.ts`), so the handler's own requirement channel is `never`.
 *
 * `parameters` is `Tool.EmptyParams`, not the brief's `Schema.Struct({})`:
 * a zero-key `Schema.Struct` fails `McpServer.layerStdio`'s build with a
 * `SchemaError` (`MissingKey` at path `type`) when the toolkit registers
 * its JSON Schema, reproduced in isolation against a minimal tool and
 * confirmed fixed by switching to `Tool.EmptyParams` — the same schema
 * Effect's own MCP conformance fixtures use for parameterless tools
 * (`.repos/effect/packages/effect/test/ai/McpServer/McpConformance/McpConformanceFixtures.ts:38`).
 *
 * @public
 */
export const describeVocabulary = Tool.make("describe_vocabulary", {
	description: DESCRIPTION,
	parameters: Tool.EmptyParams,
	success: DescribeVocabularySuccess,
	failure: McpToolError,
})
	.annotate(Tool.Title, "Describe okfit vocabulary")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

/** @public */
export const handleDescribeVocabulary = (projectRoot: string) =>
	Effect.gen(function* () {
		const resolved = yield* resolveConfigOnly(projectRoot);
		const envelope = contextEnvelope({
			projectRoot: resolved.projectRoot,
			bundleRoot: resolved.bundleRoot,
			configPath: Option.match(resolved.discovered, { onNone: () => null, onSome: (d) => d.path }),
			profile: Option.match(resolved.profile, { onNone: () => null, onSome: (p) => p.name }),
			profileRequested: resolved.profileName,
			indexPath: "",
			indexExists: false,
			config: resolved.config,
		});
		const docsPresets = Option.match(resolved.profile, { onNone: () => [], onSome: (p) => p.docsPresets });
		return {
			project_root: envelope.project_root,
			bundle_root: envelope.bundle_root,
			config_path: envelope.config_path,
			profile: envelope.profile,
			profile_requested: envelope.profile_requested,
			agent: envelope.actors.agent,
			types: envelope.types,
			tags: envelope.tags,
			docs_presets: docsPresets.map((preset) => ({
				name: preset.name,
				description: preset.description,
				additive: preset.additive,
				surfaces: preset.surfaces.map((s) => ({ file: s.file, frontmatter: s.frontmatter, body: s.body })),
			})),
		};
	});
