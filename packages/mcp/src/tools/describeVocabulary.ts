import { AppDirs, Xdg } from "@effected/xdg";
import { contextEnvelope } from "@okfit/engine";
import { Profiles } from "@okfit/profiles";
import { Effect, FileSystem, Option, Path } from "effect";
import { Tool } from "effect/ai";
import { McpToolError } from "../errors.js";
import { resolveConfigOnly } from "../internal/toolContext.js";
import { DescribeVocabularySuccess } from "../schema/tools.js";

const DESCRIPTION =
	"Returns this project's resolved okfit configuration: project root, bundle root, active profile, agent actor, every concept type and tag the config declares, and docs_presets, the Surface templates for each repository shape. Call this first, before filtering or writing any concept, to learn which names exist.";
("Returns this project's resolved okfit configuration: the project root, bundle root, active profile, configured agent actor, the full set of concept types and tags the config declares, each with its description, and docs_presets: the documentation-surface templates (Surface concept frontmatter and body) for each repository shape. Call this first, before filtering or writing any concept, to learn which type and tag names actually exist in this project.");

/**
 * `dependencies` names the platform services `handleDescribeVocabulary`
 * needs (`resolveConfigOnly` -> `resolveProjectConfig`/`provideConfig`);
 * without it `Tool.HandlerServices` infers `never` and the handler record
 * passed to `Toolkit.toLayer` fails to typecheck against `HandlersFrom`
 * (verified against `.repos/effect/packages/effect/src/ai/Tool.ts`
 * `dependencies`/`HandlerServices`; not spelled out in the brief's snippet).
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
	dependencies: [FileSystem.FileSystem, Path.Path, AppDirs, Xdg],
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
		return {
			project_root: envelope.project_root,
			bundle_root: envelope.bundle_root,
			config_path: envelope.config_path,
			profile: envelope.profile,
			profile_requested: envelope.profile_requested,
			agent: envelope.actors.agent,
			types: envelope.types,
			tags: envelope.tags,
			docs_presets: Profiles.softwareProject.docsPresets.map((preset) => ({
				name: preset.name,
				description: preset.description,
				additive: preset.additive,
				surfaces: preset.surfaces.map((s) => ({ file: s.file, frontmatter: s.frontmatter, body: s.body })),
			})),
		};
	});
