import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { copyFixtureProject } from "./utils/fixtureProject.js";
import { makeHarness } from "./utils/harness.js";

const open = () =>
	Effect.gen(function* () {
		const root = yield* copyFixtureProject("project");
		const harness = yield* makeHarness(root);
		yield* harness.initialize;
		return harness;
	});

const TOOL_NAMES = [
	"concept_neighbors",
	"describe_vocabulary",
	"get_concept",
	"list_concepts",
	"stale_report",
	"validate_bundle",
] as const;

/**
 * Recursively assert `additionalProperties === false` at every node whose
 * `type` is `"object"`, descending properties, items, prefixItems, anyOf,
 * oneOf, allOf and $defs. One structural test, not six hand-written ones.
 */
const walkStrict = (node: unknown, path: string, seen: Set<unknown>): void => {
	if (typeof node !== "object" || node === null) return;
	if (seen.has(node)) return;
	seen.add(node);
	if (Array.isArray(node)) {
		node.forEach((child, index) => {
			walkStrict(child, `${path}[${index}]`, seen);
		});
		return;
	}
	const record = node as Record<string, unknown>;
	if (record.type === "object") {
		assert.strictEqual(record.additionalProperties, false, `${path} is an object without additionalProperties:false`);
	}
	for (const key of ["properties", "items", "prefixItems", "anyOf", "oneOf", "allOf", "$defs"]) {
		const child = record[key];
		if (child === undefined) continue;
		if (key === "properties" || key === "$defs") {
			for (const [name, value] of Object.entries(child as Record<string, unknown>)) {
				walkStrict(value, `${path}.${key}.${name}`, seen);
			}
		} else {
			walkStrict(child, `${path}.${key}`, seen);
		}
	}
};

describe("served schema", () => {
	it.effect("serves exactly the six okfit tools", () =>
		Effect.gen(function* () {
			const tools = yield* (yield* open()).listTools;
			assert.deepStrictEqual(tools.map((tool) => tool.name).toSorted(), [...TOOL_NAMES]);
		}).pipe(Effect.scoped),
	);

	it.effect("every tool's input schema sets additionalProperties false at every object level", () =>
		Effect.gen(function* () {
			// Input only (N-15, and this case's own title): an output schema may
			// legitimately carry an open record — get_concept.outputSchema's
			// `frontmatter` (`Schema.Record(Schema.String, Schema.Unknown)`) is
			// exactly that, and the served JSON schema drops `additionalProperties`
			// entirely for it rather than setting it to `false`
			// (toJsonSchemaDocument.ts:419-469: a single index signature with no
			// property signatures folds through `additionalProperties[0]`, and an
			// empty compiled schema for `Schema.Unknown` is then deleted). Walking
			// output schemas here would fail against that deliberate openness.
			const tools = yield* (yield* open()).listTools;
			for (const tool of tools) {
				walkStrict(tool.inputSchema, `${tool.name}.inputSchema`, new Set());
			}
		}).pipe(Effect.scoped),
	);

	it.effect("every tool is annotated readOnly, idempotent, and closed-world", () =>
		Effect.gen(function* () {
			const tools = yield* (yield* open()).listTools;
			for (const tool of tools) {
				const annotations = (tool.annotations ?? {}) as Record<string, unknown>;
				assert.strictEqual(annotations.readOnlyHint, true, `${tool.name} readOnlyHint`);
				assert.strictEqual(annotations.idempotentHint, true, `${tool.name} idempotentHint`);
				assert.strictEqual(annotations.openWorldHint, false, `${tool.name} openWorldHint`);
			}
		}).pipe(Effect.scoped),
	);

	it.effect("every tool has a title annotation and a description under 400 characters", () =>
		Effect.gen(function* () {
			const tools = yield* (yield* open()).listTools;
			for (const tool of tools) {
				const annotations = (tool.annotations ?? {}) as Record<string, unknown>;
				const title = tool.title ?? annotations.title;
				assert.ok(typeof title === "string" && title.length > 0, `${tool.name} has no title`);
				assert.ok((tool.description?.length ?? 0) > 0, `${tool.name} has no description`);
				assert.ok((tool.description?.length ?? 0) < 400, `${tool.name} description is ${tool.description?.length}`);
			}
		}).pipe(Effect.scoped),
	);

	it.effect("every tool serves an output schema", () =>
		Effect.gen(function* () {
			const tools = yield* (yield* open()).listTools;
			for (const tool of tools) {
				assert.ok(tool.outputSchema !== undefined, `${tool.name} has no outputSchema`);
			}
		}).pipe(Effect.scoped),
	);

	it.effect("serves both okf resources with mimeType text/markdown", () =>
		Effect.gen(function* () {
			const harness = yield* open();
			const resources = yield* harness.listResources;
			const index = resources.find((resource) => resource.uri === "okf://index");
			assert.strictEqual(index?.mimeType, "text/markdown");
			const concept = resources.find((resource) => resource.uri?.startsWith("okf://concept/"));
			assert.strictEqual(concept?.mimeType, "text/markdown");
		}).pipe(Effect.scoped),
	);
});
