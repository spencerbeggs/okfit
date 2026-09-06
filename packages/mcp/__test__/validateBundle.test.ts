import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { MCP_VERSION } from "../src/index.js";
import { copyFixtureProject } from "./utils/fixtureProject.js";
import { makeHarness } from "./utils/harness.js";

interface Envelope {
	readonly schema: 1;
	readonly okfit_version: string;
	readonly okf_version: string;
	readonly root: string;
	readonly profile: string | null;
	readonly exit_code: 0 | 1 | 2;
	readonly summary: {
		readonly conformance_errors: number;
		readonly lint_errors: number;
		readonly lint_warnings: number;
		readonly lint_info: number;
		readonly profile_errors: number;
		readonly concepts: number;
	};
	readonly diagnostics: ReadonlyArray<{ readonly code: string; readonly file: string; readonly severity: string }>;
}

const validate = (
	args: Record<string, unknown>,
	mutate?: (root: string) => Effect.Effect<void, never, FileSystem.FileSystem | Path.Path>,
	fixture: "project" | "missing-bundle" = "project",
) =>
	Effect.gen(function* () {
		const root = yield* copyFixtureProject(fixture);
		// mutate needs FileSystem/Path; copyFixtureProject provides NodeServices
		// internally for its own use but does not leak it to the caller's
		// requirement channel, so it is provided again here (same pattern).
		if (mutate !== undefined) yield* mutate(root).pipe(Effect.provide(NodeServices.layer));
		const harness = yield* makeHarness(root);
		yield* harness.initialize;
		return yield* harness.callTool("validate_bundle", args);
	});

describe("validate_bundle", () => {
	it.effect("returns exit_code 0 and the fixture's known diagnostics for the clean bundle", () =>
		Effect.gen(function* () {
			const result = yield* validate({});
			assert.notOk(result.isError);
			const data = result.structuredContent as Envelope;
			assert.strictEqual(data.exit_code, 0);
			assert.strictEqual(data.summary.conformance_errors, 0);
			assert.strictEqual(data.summary.lint_errors, 0);
			assert.strictEqual(data.summary.profile_errors, 0);
			assert.strictEqual(data.summary.concepts, 10);
			assert.strictEqual(data.profile, null);
			// Verified live against this fixture (task brief Step 2's own
			// instruction): with metrics/churn.md in place, its own deliberate
			// dangling link (to metrics/does-not-exist.md) adds a second
			// core.lint warning, broken-links, alongside the vendored corpus's
			// log-frontmatter -- 2, not the brief's predicted 1.
			assert.strictEqual(data.summary.lint_warnings, 2);
			assert.ok(data.diagnostics.some((diagnostic) => diagnostic.code === "log-frontmatter"));
			assert.ok(data.diagnostics.some((diagnostic) => diagnostic.code === "broken-links"));
		}).pipe(Effect.scoped),
	);

	it.effect("reports a conformance error when a concept file loses its frontmatter", () =>
		Effect.gen(function* () {
			const result = yield* validate({}, (root) =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const path = yield* Path.Path;
					yield* fs.writeFileString(path.join(root, "bundle", "metrics", "churn.md"), "# Churn\n\nNo frontmatter.\n");
				}).pipe(Effect.orDie),
			);
			const data = result.structuredContent as Envelope;
			assert.ok(data.summary.conformance_errors > 0);
			// K-7/K-8's exit-code contract (render/exit.ts:forDiagnostics): a
			// conformance error alone maps to 2, not 1 -- 1 is lint/profile
			// errors only. The brief's literal snippet predates this check.
			assert.strictEqual(data.exit_code, 2);
		}).pipe(Effect.scoped),
	);

	it.effect("reports the stale lint finding when now is past a concept's stale_after", () =>
		Effect.gen(function* () {
			const data = (yield* validate({ now: "2027-01-01T00:00:00Z" })).structuredContent as Envelope;
			assert.ok(data.diagnostics.some((diagnostic) => diagnostic.code === "stale"));
		}).pipe(Effect.scoped),
	);

	it.effect("reports okfit_version as the mcp package's own version", () =>
		Effect.gen(function* () {
			const data = (yield* validate({})).structuredContent as Envelope;
			assert.strictEqual(data.okfit_version, MCP_VERSION);
		}).pipe(Effect.scoped),
	);

	// A typed tool failure never carries `structuredContent` on the wire under
	// `failureMode: "error"` (B1's ruling, progress.md): only `error.message`
	// reaches `tools/call`'s `content[0].text`. This asserts the composed
	// message includes both the root and the remediation hint, catching a
	// regression where `run()`'s failure is mapped to `BundleNotFound` with
	// a bare `cause.message` instead of `composeRemediatedMessage`.
	it.effect("fails BundleNotFound when the config's bundle path does not exist, with a composed remediation", () =>
		Effect.gen(function* () {
			const result = yield* validate({}, undefined, "missing-bundle");
			assert.ok(result.isError);
			const text = result.content[0]?.text ?? "";
			assert.ok(text.includes("no-such-bundle"));
			assert.ok(text.includes("okfit init"));
		}).pipe(Effect.scoped),
	);
});
