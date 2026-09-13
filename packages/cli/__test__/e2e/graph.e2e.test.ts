// Acceptance suite for `okfit graph` (issue #17): same handler skeleton as
// `okfit validate`/`okfit context`, diverging into `@okfit/engine`'s
// `runGraph`. Spawns the built dist/dev bin (K-43), never Command.run
// in-process, per this package's e2e convention.
//
// K-44: no CLI-owned fixture. Reuses the same software-project fixture
// validate.e2e.test.ts names CLEAN_FIXTURE.

import { join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { copyFixtureInto, makeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

const PROFILES_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "profiles", "__test__", "fixtures");
const CLEAN_FIXTURE = join(PROFILES_FIXTURES, "software-project");

describe("okfit graph: default format", () => {
	it.effect("prints Mermaid (a flowchart) with nothing else on stdout, exits 0", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["graph"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, "");
			assert.isTrue(result.stdout.startsWith("flowchart"));
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit graph --format dot", () => {
	it.effect("prints GraphViz DOT with nothing else on stdout, exits 0", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["graph", "--format", "dot"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, "");
			assert.isTrue(result.stdout.startsWith("digraph"));
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit graph --format json", () => {
	it.effect("prints a GraphEnvelope with node and edge lists, exits 0", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["graph", "--format", "json"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, "");
			const bundleRoot = join(sandbox.cwd, "okf");
			const envelope = JSON.parse(result.stdout) as {
				readonly schema: number;
				readonly root: string;
				readonly profile: string;
				readonly summary: { readonly nodes: number; readonly edges: number };
				readonly nodes: ReadonlyArray<{ readonly id: string; readonly kind: string }>;
				readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string; readonly source: string }>;
			};
			assert.strictEqual(envelope.schema, 1);
			assert.strictEqual(envelope.root, bundleRoot);
			assert.strictEqual(envelope.profile, "software-project");
			assert.strictEqual(envelope.summary.nodes, envelope.nodes.length);
			assert.strictEqual(envelope.summary.edges, envelope.edges.length);
			assert.isTrue(envelope.nodes.length > 0);
			assert.isTrue(envelope.nodes.some((n) => n.kind === "concept"));
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("exit 3 under json still gets the K-22 error envelope on stdout", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const missingConfig = join(sandbox.cwd, "does-not-exist.toml");

			const result = yield* runOkfit(["graph", "--format", "json", "--config", missingConfig], sandbox);

			assert.strictEqual(result.exitCode, 3);
			const envelope = JSON.parse(result.stdout) as {
				readonly schema: number;
				readonly exit_code: number;
				readonly error: { readonly tag: string };
			};
			assert.strictEqual(envelope.schema, 1);
			assert.strictEqual(envelope.exit_code, 3);
			assert.strictEqual(envelope.error.tag, "ConfigPathNotFoundError");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
