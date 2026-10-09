import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { CliUiTest } from "@effected/cli/ui/testing";
import { Git } from "@effected/git";
import { OkfitConfig } from "@okfit/core";
import type { SyncOptions } from "@okfit/engine";
import { GitHistory } from "@okfit/profiles";
import { DateTime, Effect, Exit, Fiber, Layer, Option } from "effect";
import { syncWithConfirm } from "../../src/commands/sync-confirm.js";
import { FILES, withBundle } from "../utils/picker.js";

/** Index-only needs no git history; `add`/`stagedChanges` serve the --staged case. */
const fakes = (root: string) =>
	Layer.mergeAll(
		Layer.succeed(Git, {
			repoRoot: () => Effect.succeed(root),
			stagedChanges: () => Effect.succeed([]),
			add: () => Effect.void,
		} as unknown as Git["Service"]),
		Layer.succeed(GitHistory, {} as unknown as GitHistory["Service"]),
		NodeServices.layer,
	);

const options = (root: string, extra: Partial<SyncOptions> = {}): SyncOptions => ({
	bundleRoot: root,
	config: OkfitConfig.DEFAULTS,
	modes: new Set(["index"] as const),
	dryRun: false,
	...extra,
});

const exists = (root: string, file: string) =>
	Effect.promise(() =>
		access(join(root, file)).then(
			() => true,
			() => false,
		),
	);

const start = (root: string, extra: Partial<SyncOptions> = {}, yes = false) =>
	Effect.gen(function* () {
		const session = yield* CliUiTest.session({ interactive: true });
		const fiber = yield* Effect.forkScoped(
			syncWithConfirm(options(root, extra), yes).pipe(Effect.provide(session.layer), Effect.provide(fakes(root))),
		);
		return { session, fiber };
	});

describe("syncWithConfirm", () => {
	it.effect("shows the plan, asks Write N file(s)?, and enter writes", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root);
					const confirm = yield* session.next({ contains: "Write 3 file(s)?" });
					assert.isFalse(yield* exists(root, "index.md"));
					assert.include(yield* session.stdout, "would write 3");
					yield* confirm.press("enter");
					const result = yield* Fiber.join(fiber);
					assert.isFalse(result.dryRun);
					assert.strictEqual(result.index.written.length, 3);
					assert.isTrue(yield* exists(root, "index.md"));
				}),
			),
		),
	);

	it.effect("escape writes nothing and fails Cancelled", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root);
					const confirm = yield* session.next({ contains: "Write 3 file(s)?" });
					yield* confirm.press("escape");
					const exit = yield* Fiber.join(fiber).pipe(Effect.exit);
					assert.isTrue(Exit.isFailure(exit));
					assert.deepStrictEqual(CliUiTest.cancelReason(exit), Option.some("escape"));
					assert.isFalse(yield* exists(root, "index.md"));
				}),
			),
		),
	);

	it.effect("an already-synced bundle shows no prompt", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const first = yield* start(root, {}, true);
					yield* Fiber.join(first.fiber);
					const before = yield* Effect.promise(() => readFile(join(root, "index.md"), "utf8"));
					const { fiber } = yield* start(root);
					const result = yield* Fiber.join(fiber);
					assert.strictEqual(result.index.written.length, 0);
					assert.isFalse(result.dryRun);
					assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "index.md"), "utf8")), before);
				}),
			),
		),
	);

	it.effect("--yes writes without prompting", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { fiber } = yield* start(root, {}, true);
					const result = yield* Fiber.join(fiber);
					assert.strictEqual(result.index.written.length, 3);
					assert.isTrue(yield* exists(root, "index.md"));
				}),
			),
		),
	);

	it.effect("--dry-run never prompts and writes nothing", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { fiber } = yield* start(root, { dryRun: true });
					const result = yield* Fiber.join(fiber);
					assert.isTrue(result.dryRun);
					assert.isFalse(yield* exists(root, "index.md"));
				}),
			),
		),
	);

	it.effect("--staged never prompts, even on an interactive session (a human can run the hook)", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const staged = { at: DateTime.makeUnsafe("2026-10-09T00:00:00Z") };
					const { session, fiber } = yield* start(root, { modes: new Set(["generated", "index"]), staged });
					const result = yield* Fiber.join(fiber);
					assert.isFalse(result.dryRun);
					assert.isTrue(yield* exists(root, "index.md"));
					assert.notInclude(yield* session.stdout, "Write");
				}),
			),
		),
	);
});
