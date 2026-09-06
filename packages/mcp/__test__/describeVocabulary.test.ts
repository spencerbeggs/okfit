import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { DescribeVocabularySuccess } from "../src/index.js";
import { copyFixtureProject } from "./utils/fixtureProject.js";
import { makeHarness } from "./utils/harness.js";

const call = (fixture: "project" | "broken-config") =>
	Effect.gen(function* () {
		const root = yield* copyFixtureProject(fixture);
		const harness = yield* makeHarness(root);
		yield* harness.initialize;
		const result = yield* harness.callTool("describe_vocabulary", {});
		return { root, result };
	});

describe("describe_vocabulary", () => {
	it.effect("returns the fixture project root, bundle root, config path, profile, agent, types and tags", () =>
		Effect.gen(function* () {
			const { root, result } = yield* call("project");
			assert.notOk(result.isError);
			const data = result.structuredContent as DescribeVocabularySuccess;
			assert.strictEqual(data.project_root, root);
			assert.ok(data.bundle_root.endsWith("/bundle"));
			assert.ok(data.config_path?.endsWith("okfit.config.toml"));
			assert.strictEqual(data.agent, "okfit/claude-code");
			assert.deepStrictEqual(
				data.types.map((type) => type.name),
				["Attested Computation", "BigQuery Table", "Dashboard", "Metric", "Policy", "Skill"],
			);
			assert.strictEqual(data.tags.length, 13);
		}).pipe(Effect.scoped),
	);

	it.effect('profile is null and profile_requested is "none" when the config sets bundle.profile = "none"', () =>
		Effect.gen(function* () {
			const { result } = yield* call("project");
			const data = result.structuredContent as DescribeVocabularySuccess;
			assert.strictEqual(data.profile, null);
			assert.strictEqual(data.profile_requested, "none");
		}).pipe(Effect.scoped),
	);

	it.effect("types and tags are sorted by name", () =>
		Effect.gen(function* () {
			const { result } = yield* call("project");
			const data = result.structuredContent as DescribeVocabularySuccess;
			const typeNames = data.types.map((type) => type.name);
			const tagNames = data.tags.map((tag) => tag.name);
			assert.deepStrictEqual(typeNames, typeNames.toSorted());
			assert.deepStrictEqual(tagNames, tagNames.toSorted());
		}).pipe(Effect.scoped),
	);

	// A typed tool failure (`failureMode: "error"`, the default and the only
	// mode this contract uses) never reaches the wire with `structuredContent`:
	// `McpServer`'s own `registerToolkit` catches the raw failure and always
	// returns `{ isError: true, content: [{ type: "text", text: error.message }] }`
	// — the `_tag`/`remediation` shape lives only in the failed `Effect`'s
	// typed error, not in what `tools/call` serializes
	// (`unstable/ai/McpServer.ts:1502-1506,1576-1584`, verified by running this
	// exact case and reading its raw response). This is a fact the brief itself
	// asked this task to discover and record (Step 17). The controller's fix
	// round (progress.md, "Ruling (B1, binds every C task)") resolved it by
	// composing the remediation hint into every `McpToolError` member's own
	// `message` at construction (`errors.ts`'s `composeRemediatedMessage`), so
	// the hint still reaches the wire even though `structuredContent` doesn't
	// carry it — asserted here directly against the response text.
	it.effect("fails ConfigError for a malformed config file, with the remediation hint in the wire message", () =>
		Effect.gen(function* () {
			const { result } = yield* call("broken-config");
			assert.ok(result.isError);
			assert.strictEqual(result.content.length, 1);
			assert.strictEqual(result.content[0]?.type, "text");
			const text = result.content[0]?.text ?? "";
			assert.ok(text.length > 0);
			assert.ok(
				text.includes(
					"Check the project's okfit.config.toml or .config/okfit/config.toml for a syntax or schema error; remove it to fall back to defaults.",
				),
			);
			assert.ok(text.includes("Try describe_vocabulary."));
		}).pipe(Effect.scoped),
	);
});
