import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ENGINE_VERSION } from "@okfit/engine";
import { Effect, FileSystem, Path } from "effect";
import type { ServerOptions } from "../src/server.js";
import { copyFixtureProject } from "./utils/fixtureProject.js";
import { makeHarness } from "./utils/harness.js";

interface Envelope {
	readonly schema: 1;
	readonly okfit_version: string;
	readonly engine_version: string;
	readonly producer: string;
	readonly distribution: { readonly name: string; readonly version: string } | null;
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
	serverOptions: ServerOptions = {},
) =>
	Effect.gen(function* () {
		const root = yield* copyFixtureProject(fixture);
		// mutate needs FileSystem/Path; copyFixtureProject provides NodeServices
		// internally for its own use but does not leak it to the caller's
		// requirement channel, so it is provided again here (same pattern).
		if (mutate !== undefined) yield* mutate(root).pipe(Effect.provide(NodeServices.layer));
		const harness = yield* makeHarness(root, serverOptions);
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
			// log-frontmatter -- 2, not the brief's predicted 1. The fixture's
			// .config/okfit.toml sets actors.agent and metrics/churn.md has no
			// generated block, so generated-missing (issue #73) adds a third.
			assert.strictEqual(data.summary.lint_warnings, 3);
			assert.ok(data.diagnostics.some((diagnostic) => diagnostic.code === "log-frontmatter"));
			assert.ok(data.diagnostics.some((diagnostic) => diagnostic.code === "broken-links"));
			assert.ok(data.diagnostics.some((diagnostic) => diagnostic.code === "generated-missing"));
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

	it.effect("reports okfit_version as a version string", () =>
		Effect.gen(function* () {
			const data = (yield* validate({})).structuredContent as Envelope;
			assert.match(String(data.okfit_version), /^\d+\.\d+\.\d+/);
		}).pipe(Effect.scoped),
	);

	// okfit #75: the CLI and this tool report different okfit_version values
	// because each names its own package; producer labels which one.
	it.effect("labels the report's producer as @okfit/mcp", () =>
		Effect.gen(function* () {
			const data = (yield* validate({})).structuredContent as Envelope;
			assert.strictEqual(data.producer, "@okfit/mcp");
		}).pipe(Effect.scoped),
	);

	// okfit #137: engine_version/okf_version are the pair a reader compares;
	// distribution is null unless ServerLayer was given one.
	it.effect("reports engine_version === ENGINE_VERSION and distribution: null by default", () =>
		Effect.gen(function* () {
			const data = (yield* validate({})).structuredContent as Envelope;
			assert.strictEqual(data.engine_version, ENGINE_VERSION);
			assert.isNull(data.distribution);
		}).pipe(Effect.scoped),
	);

	it.effect("echoes whatever distribution ServerLayer was given", () =>
		Effect.gen(function* () {
			const data = (yield* validate({}, undefined, "project", {
				distribution: { name: "@okfit/plugin", version: "0.3.7" },
			})).structuredContent as Envelope;
			assert.deepStrictEqual(data.distribution, { name: "@okfit/plugin", version: "0.3.7" });
		}).pipe(Effect.scoped),
	);

	// A typed tool failure never carries `structuredContent` on the wire under
	// `failureMode: "error"` (B1's ruling, progress.md): only `error.message`
	// reaches `tools/call`'s `content[0].text`. This asserts the composed
	// message includes both the root and the remediation hint, catching a
	// regression where `run()`'s failure is mapped to `BundleNotFound` with
	// a bare `cause.message` instead of `@effected/mcp`'s
	// `ToolFailure.message(raw, remediation)`.
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

const CHURN_ON_DISK = readFileSync(
	resolve(import.meta.dirname, "fixtures", "project", "bundle", "metrics", "churn.md"),
	"utf8",
);
/** churn.md with its one deliberate dangling link sentence removed; everything else byte-identical. */
const CHURN_FIXED = CHURN_ON_DISK.replace(/\nThe intended computation is[\s\S]*?yet\.\n/, "\n");
const NEW_METRIC = CHURN_FIXED.replace("title: Churn", "title: Retention").replace("# Definition", "# Retention");

describe("validate_bundle documents", () => {
	it("the fixture edit is real (guards the regex above)", () => {
		assert.notStrictEqual(CHURN_FIXED, CHURN_ON_DISK);
		assert.notInclude(CHURN_FIXED, "does-not-exist.md");
	});

	it.effect("an unsaved fix clears broken-links for that call only; the next call without documents sees disk", () =>
		Effect.gen(function* () {
			const root = yield* copyFixtureProject("project");
			const harness = yield* makeHarness(root, {});
			yield* harness.initialize;
			const drafted = (yield* harness.callTool("validate_bundle", {
				documents: [{ path: "metrics/churn.md", text: CHURN_FIXED }],
			})).structuredContent as Envelope;
			assert.isFalse(drafted.diagnostics.some((d) => d.code === "broken-links"));
			const plain = (yield* harness.callTool("validate_bundle", {})).structuredContent as Envelope;
			assert.isTrue(plain.diagnostics.some((d) => d.code === "broken-links" && d.file === "metrics/churn.md"));
		}).pipe(Effect.scoped),
	);

	it.effect("an unsaved new file is walked: the concept count grows by one", () =>
		Effect.gen(function* () {
			const result = yield* validate({ documents: [{ path: "metrics/retention.md", text: NEW_METRIC }] });
			assert.notOk(result.isError);
			assert.strictEqual((result.structuredContent as Envelope).summary.concepts, 11);
		}).pipe(Effect.scoped),
	);

	it.effect("a path outside the bundle fails InvalidArgument naming the path and the fix", () =>
		Effect.gen(function* () {
			const result = yield* validate({ documents: [{ path: "../outside.md", text: "x" }] });
			assert.ok(result.isError);
			const text = result.content[0]?.text ?? "";
			assert.include(text, 'document path "../outside.md" resolves outside the bundle root');
			assert.include(text, "relative to the bundle root");
		}).pipe(Effect.scoped),
	);
});
