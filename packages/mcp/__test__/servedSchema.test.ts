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
 * Recursively assert that every node whose `type` is `"object"` declares
 * `additionalProperties` explicitly, and that any object with declared
 * `properties` is closed (`false`), descending properties, items,
 * prefixItems, anyOf, oneOf, allOf and $defs. One structural test, not six
 * hand-written ones.
 */
const walkClosed = (node: unknown, path: string, seen: Set<unknown>): void => {
	if (typeof node !== "object" || node === null) return;
	if (seen.has(node)) return;
	seen.add(node);
	if (Array.isArray(node)) {
		node.forEach((child, index) => {
			walkClosed(child, `${path}[${index}]`, seen);
		});
		return;
	}
	const record = node as Record<string, unknown>;
	if (record.type === "object") {
		assert.isBoolean(record.additionalProperties, `${path} is an object without an explicit additionalProperties`);
		if (record.properties !== undefined) {
			assert.strictEqual(record.additionalProperties, false, `${path} declares properties but is not closed`);
		}
	}
	for (const key of ["properties", "items", "prefixItems", "anyOf", "oneOf", "allOf", "$defs"]) {
		const child = record[key];
		if (child === undefined) continue;
		if (key === "properties" || key === "$defs") {
			for (const [name, value] of Object.entries(child as Record<string, unknown>)) {
				walkClosed(value, `${path}.${key}.${name}`, seen);
			}
		} else {
			walkClosed(child, `${path}.${key}`, seen);
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

	it.effect("every tool's input schema is closed, and an unknown key is reported by name", () =>
		Effect.gen(function* () {
			// `@effected/mcp`'s `McpToolkit.layer` (`server.ts`) registers every
			// unannotated tool strict by default (`strict: "all"`), restoring the
			// closed-world input contract N-15 originally asked for: core serves
			// `additionalProperties: false` on every object node of a strict
			// tool's input schema again, where the bare `McpServer.toolkit` this
			// package used before left every tool open (matching the decoder's
			// then-default `onExcessProperty: "ignore"`). Input only: an output
			// schema may legitimately carry an open record — get_concept.outputSchema's
			// `frontmatter` (`Schema.Record(Schema.String, Schema.Unknown)`) drops
			// `additionalProperties` entirely.
			const tools = yield* (yield* open()).listTools;
			for (const tool of tools) {
				walkClosed(tool.inputSchema, `${tool.name}.inputSchema`, new Set());
			}
		}).pipe(Effect.scoped),
	);

	it.effect("an unknown top-level argument is rejected naming every unknown key, not only the first", () =>
		Effect.gen(function* () {
			const harness = yield* open();
			const result = yield* harness.callTool("get_concept", { id: "metrics/revenue", bogus: 1, extra: 2 });
			assert.strictEqual(result.isError, true);
			const text = result.content[0]?.text ?? "";
			assert.include(text, "bogus");
			assert.include(text, "extra");
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
