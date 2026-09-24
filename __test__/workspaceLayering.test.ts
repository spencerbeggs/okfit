import { resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Workspaces } from "@effected/workspaces";
import { LayerEdge, LayerPolicy, WorkspaceLayering } from "@effected/workspaces/testing";
import { Effect, Layer } from "effect";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const Live = Workspaces.layer({ cwd: REPO_ROOT }).pipe(Layer.provideMerge(NodeServices.layer));

/**
 * Holds okfit's own package graph to the committed `layers.json` (K-9's
 * dependency-closure conventions in prose, this time checked): the carrier
 * (`@okfit/plugin`) depends only on the three front ends
 * (`@okfit/cli`/`@okfit/mcp`/`@okfit/lsp`), which depend only on the
 * engine, which depends only on `@okfit/profiles` and `@okfit/core`. No
 * front end may depend on another, and nothing may depend upward. `okfit`
 * (the private root), `scratchpad` (the ghost workspace, which legitimately
 * depends on every package as a probe venue) and `@okfit/vscode-extension`
 * (a separate consumer that only build-time devDepends on `@okfit/lsp`) are
 * `unconstrained`; `@okfit/claude-code-plugin` (no code, changeset
 * versioning only) is `tooling`.
 */
describe("workspace layering", () => {
	it.effect("the live package graph honours layers.json, non-vacuously", () =>
		Effect.gen(function* () {
			const policy = yield* LayerPolicy.load(resolve(REPO_ROOT, "layers.json"));
			const report = yield* WorkspaceLayering.checkWorkspace(policy);
			assert.deepStrictEqual(report.violations, []);
			// Non-vacuity: a discovery bug that silently found zero edges would
			// otherwise report a spotless graph for the wrong reason.
			assert.isAbove(report.edgeCount, 0);
		}).pipe(Effect.provide(Live)),
	);

	it.effect("an upward edge is a violation (positive control)", () =>
		Effect.gen(function* () {
			// "top-down": index 0 is the TOP layer, and an edge may only point
			// to a layer strictly BELOW it (a higher index). `@okfit/engine` at
			// index 0 and `@okfit/core` at index 1 is okfit's real order (engine
			// sits above core). The edge below is synthetic, not the real one:
			// the live graph only ever has `@okfit/engine -> @okfit/core`
			// (downward). `@okfit/core -> @okfit/engine` never exists on the
			// live graph -- it is manufactured here, from the bottom layer to
			// the top one, purely so this policy must flag it as an UPWARD
			// violation.
			const policy = yield* LayerPolicy.decode({
				layers: [["@okfit/engine"], ["@okfit/core"]],
				tooling: [],
				unconstrained: [],
			});
			const graph = {
				names: ["@okfit/core", "@okfit/engine"],
				edges: [LayerEdge.make({ from: "@okfit/core", to: "@okfit/engine", field: "dependencies" })],
			};
			const report = WorkspaceLayering.check(graph, policy);
			assert.isAbove(report.violations.length, 0);
		}),
	);
});
