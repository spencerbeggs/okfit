import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { AttestedComputation, ComputationAttester, ComputationExecutor } from "../src/AttestedComputation.js";
import { Concept } from "../src/Concept.js";
import type { BundleIndex } from "../src/internal/links.js";
import { isUrl, pathFieldsOf, resolvePathField, resolveTarget } from "../src/internal/links.js";
import { Source } from "../src/Source.js";

const index: BundleIndex = {
	files: new Set([
		"index.md",
		"log.md",
		"revenue.md",
		"metrics/index.md",
		"metrics/revenue.md",
		"metrics/gross-margin.md",
		"computations/revenue-ytd.md",
		"policies/revenue-recognition.md",
		"attesters/sql_equality.py",
		"notes/draft.md",
		"docs/my file.md",
	]),
	concepts: new Set([
		"revenue",
		"metrics/revenue",
		"metrics/gross-margin",
		"computations/revenue-ytd",
		"policies/revenue-recognition",
	]),
};
const from = "computations/revenue-ytd.md";
const gm = "metrics/gross-margin.md";
const node = (id: string, kind: "concept" | "file" | "missing") => ({ _tag: "node" as const, id, kind });

describe("internal/links", () => {
	it.effect("classifies URLs and self links", () =>
		Effect.sync(() => {
			assert.isTrue(isUrl("https://example.com/x.md"));
			assert.isTrue(isUrl("mailto:a@b.example"));
			assert.isFalse(isUrl("metrics/revenue.md"));
			assert.isFalse(isUrl("C:/tmp/x.md"));
			assert.deepStrictEqual(resolveTarget(from, "https://example.com/x.md", index), { _tag: "url" });
			assert.deepStrictEqual(resolveTarget(from, "#computation", index), { _tag: "self" });
			assert.deepStrictEqual(resolveTarget(from, "", index), { _tag: "self" });
		}),
	);

	it.effect("rule A: /-rooted; rule B: file-relative wins; .. escapes are external", () =>
		Effect.sync(() => {
			assert.deepStrictEqual(resolveTarget(from, "/metrics/revenue.md", index), node("metrics/revenue", "concept"));
			assert.deepStrictEqual(resolveTarget(from, "/metrics/index.md", index), node("metrics/index.md", "file"));
			assert.deepStrictEqual(resolveTarget(from, "/", index), node("index.md", "file"));
			assert.deepStrictEqual(resolveTarget(from, "/../etc/passwd", index), { _tag: "external" });
			assert.deepStrictEqual(resolveTarget(from, "/ghost/x.md", index), node("ghost/x.md", "missing"));
			assert.deepStrictEqual(resolveTarget(gm, "./revenue.md", index), node("metrics/revenue", "concept"));
			assert.deepStrictEqual(resolveTarget(gm, "revenue.md", index), node("metrics/revenue", "concept"));
			assert.deepStrictEqual(
				resolveTarget(gm, "../computations/revenue-ytd.md", index),
				node("computations/revenue-ytd", "concept"),
			);
			assert.deepStrictEqual(resolveTarget(gm, "../../outside.md", index), { _tag: "external" });
			assert.deepStrictEqual(resolveTarget(gm, "./gone.md", index), node("metrics/gone.md", "missing"));
			assert.deepStrictEqual(resolveTarget(gm, "../x/y.md", index), node("x/y.md", "missing"));
		}),
	);

	it.effect("rule C: root-relative fallback only without ./ or ../; rule D missing ids", () =>
		Effect.sync(() => {
			assert.deepStrictEqual(
				resolveTarget(from, "policies/revenue-recognition.md", index),
				node("policies/revenue-recognition", "concept"),
			);
			assert.deepStrictEqual(
				resolveTarget(from, "attesters/sql_equality.py", index),
				node("attesters/sql_equality.py", "file"),
			);
			assert.deepStrictEqual(resolveTarget(from, "lib/query.sql", index), node("lib/query.sql", "missing"));
			assert.deepStrictEqual(resolveTarget(from, "check.py", index), node("computations/check.py", "missing"));
		}),
	);

	it.effect("directory targets, .md retry, fragment/query stripping, percent-decoding, non-concept .md", () =>
		Effect.sync(() => {
			assert.deepStrictEqual(resolveTarget(from, "/metrics/", index), node("metrics/index.md", "file"));
			assert.deepStrictEqual(resolveTarget(from, "../metrics/", index), node("metrics/index.md", "file"));
			assert.deepStrictEqual(resolveTarget(from, "/ghost/", index), node("ghost/index.md", "missing"));
			assert.deepStrictEqual(resolveTarget(from, "/metrics/revenue", index), node("metrics/revenue", "concept"));
			assert.deepStrictEqual(
				resolveTarget(from, "/attesters/sql_equality", index),
				node("attesters/sql_equality", "missing"),
			);
			assert.deepStrictEqual(
				resolveTarget(from, "/metrics/revenue.md#definition", index),
				node("metrics/revenue", "concept"),
			);
			assert.deepStrictEqual(resolveTarget(from, "/metrics/revenue.md?v=1", index), node("metrics/revenue", "concept"));
			assert.deepStrictEqual(resolveTarget(from, "/docs/my%20file.md", index), node("docs/my file.md", "file"));
			assert.deepStrictEqual(resolveTarget(from, "/notes/draft.md", index), node("notes/draft.md", "file"));
			assert.deepStrictEqual(resolveTarget(from, "/log.md", index), node("log.md", "file"));
		}),
	);

	it.effect("sources.resource: whitespace or a miss is a descriptor; other fields stay missing", () =>
		Effect.sync(() => {
			const source = "sources.resource";
			assert.deepStrictEqual(resolvePathField(from, source, "all queries in BigQuery project X", index), {
				_tag: "descriptor",
			});
			assert.deepStrictEqual(resolvePathField(from, source, "dashboards/exec-revenue", index), { _tag: "descriptor" });
			assert.deepStrictEqual(resolvePathField(from, source, "https://example.com/", index), { _tag: "url" });
			assert.deepStrictEqual(
				resolvePathField(from, source, "policies/revenue-recognition.md", index),
				node("policies/revenue-recognition", "concept"),
			);
			assert.deepStrictEqual(
				resolvePathField(from, "attester.resource", "dashboards/x.py", index),
				node("dashboards/x.py", "missing"),
			);
			assert.deepStrictEqual(resolvePathField(from, "resource", "../../x.md", index), { _tag: "external" });
		}),
	);

	it.effect("pathFieldsOf lists the five path fields in frontmatter order", () =>
		Effect.sync(() => {
			const concept = new Concept({
				type: "Attested Computation",
				resource: "https://example.com/asset",
				sources: [new Source({ resource: "policies/a.md" }), new Source({ resource: "all queries in project X" })],
				attested: new AttestedComputation({
					parameters: [],
					computation: "lib/q.sql",
					executor: new ComputationExecutor({ resource: "skills/run.md", receipt: [] }),
					attester: new ComputationAttester({ resource: "attesters/eq.py" }),
				}),
				extensions: {},
				raw: {},
			});
			assert.deepStrictEqual(pathFieldsOf(concept), [
				{ field: "resource", raw: "https://example.com/asset" },
				{ field: "sources.resource", raw: "policies/a.md" },
				{ field: "sources.resource", raw: "all queries in project X" },
				{ field: "computation", raw: "lib/q.sql" },
				{ field: "executor.resource", raw: "skills/run.md" },
				{ field: "attester.resource", raw: "attesters/eq.py" },
			]);
			assert.deepStrictEqual(pathFieldsOf(new Concept({ type: "Note", extensions: {}, raw: {} })), []);
		}),
	);
});
