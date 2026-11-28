import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { NotInteractive } from "@effected/cli-kit";
import { CliUiTest } from "@effected/cli-kit/ui/testing";
import { Git } from "@effected/git";
import { OkfitConfig } from "@okfit/core";
import type { SyncOptions } from "@okfit/engine";
import { Derivation, GitHistory } from "@okfit/profiles";
import { Console, DateTime, Effect, Exit, Fiber, Layer, Option } from "effect";
import { syncWithConfirm, writeCount } from "../../src/commands/sync-confirm.js";
import { FILES, withBundle } from "../utils/picker.js";
import { TestPlatform } from "../utils/platform.js";

/** Index-only needs no git history; `add`/`stagedChanges` serve the --staged case. */
const fakes = (root: string) =>
	Layer.mergeAll(
		Git.layerTest({
			repoRoot: () => Effect.succeed(root),
			stagedChanges: () => Effect.succeed([]),
			// #142: --staged index mode reads the committed view through lsFiles/unstagedChanges.
			lsFiles: () => Effect.succeed([]),
			unstagedChanges: () => Effect.succeed([]),
			add: () => Effect.void,
		}),
		Layer.succeed(GitHistory, {} as unknown as GitHistory["Service"]),
		TestPlatform,
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

describe("writeCount", () => {
	const mode = { selected: true, written: [], unchanged: [], migrated: [], skipped: [] };
	it("counts a migrated generated concept once, even when it is also written", () => {
		const result = {
			bundleRoot: "/r",
			dryRun: true,
			generated: { ...mode, written: ["a"], migrated: ["a", "b"] },
			index: { ...mode, written: ["i.md"] },
			log: mode,
		};
		assert.strictEqual(writeCount(result), 3);
		assert.strictEqual(writeCount({ ...result, generated: { ...mode, migrated: ["b"] }, index: mode }), 1);
	});
});

describe("syncWithConfirm", () => {
	it.effect("shows the plan, asks Write N file(s)?, and enter writes", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root);
					const confirm = yield* session.next({ contains: "Write 3 file(s)?" });
					assert.isFalse(yield* exists(root, "index.md"));
					assert.include(yield* session.transcript, "would write 3");
					yield* confirm.press("enter");
					const result = yield* Fiber.join(fiber);
					assert.isFalse(result.dryRun);
					assert.strictEqual(result.index.written.length, 3);
					assert.isTrue(yield* exists(root, "index.md"));
				}),
			),
		),
	);

	it.effect("a confirm that cannot mount writes without printing the plan", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const session = yield* CliUiTest.session({ interactive: true });
					const lines: Array<string> = [];
					const recording = Layer.succeed(Console.Console, {
						...globalThis.console,
						log: (...args: ReadonlyArray<unknown>) => void lines.push(args.join(" ")),
					} as unknown as Console.Console);
					const result = yield* syncWithConfirm(options(root), false, () => Effect.fail(new NotInteractive())).pipe(
						Effect.provide(session.layer),
						Effect.provide(fakes(root)),
						Effect.provide(recording),
					);
					assert.isFalse(lines.some((line) => line.includes("would write")));
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

describe("syncWithConfirm: the clock warning (#509)", () => {
	const NOW = DateTime.makeUnsafe("2026-11-24T10:00:00Z");
	const aheadFiles = Effect.gen(function* () {
		const text = (digest: string) =>
			`---\ntype: Module\ntitle: Ahead\ngenerated:\n  by: human:ada\n  at: 2030-01-01T00:00:00Z\nx-okfit-integrity:\n  generated:\n    body: ${digest}\n---\n\n# Ahead\n`;
		const digest = yield* Derivation.bodyDigest(text("0000000000000000")).pipe(Effect.provide(TestPlatform));
		return [["ahead.md", text(digest)]] as ReadonlyArray<readonly [string, string]>;
	});
	const aheadOptions = (root: string) => options(root, { modes: new Set(["generated", "index"] as const), now: NOW });
	const startAhead = (root: string, shown: { clockWarning: boolean }) =>
		Effect.gen(function* () {
			const session = yield* CliUiTest.session({ interactive: true });
			const fiber = yield* Effect.forkScoped(
				syncWithConfirm(aheadOptions(root), false, undefined, shown).pipe(
					Effect.provide(session.layer),
					Effect.provide(fakes(root)),
				),
			);
			return { session, fiber };
		});

	it.effect("the confirm screen shows the warning, and records that it did", () =>
		Effect.gen(function* () {
			const files = yield* aheadFiles;
			return yield* withBundle(files, (root) =>
				Effect.scoped(
					Effect.gen(function* () {
						const shown = { clockWarning: false };
						const { session, fiber } = yield* startAhead(root, shown);
						const confirm = yield* session.next({ contains: "file(s)?" });
						assert.include(yield* session.transcript, "may be behind");
						yield* confirm.press("enter");
						const result = yield* Fiber.join(fiber);
						assert.isDefined(result.clockBehind);
						assert.isTrue(shown.clockWarning);
					}),
				),
			);
		}),
	);

	it.effect("a cancel has still shown the warning", () =>
		Effect.gen(function* () {
			const files = yield* aheadFiles;
			return yield* withBundle(files, (root) =>
				Effect.scoped(
					Effect.gen(function* () {
						const shown = { clockWarning: false };
						const { session, fiber } = yield* startAhead(root, shown);
						const confirm = yield* session.next({ contains: "file(s)?" });
						assert.include(yield* session.transcript, "may be behind");
						yield* confirm.press("escape");
						const exit = yield* Fiber.join(fiber).pipe(Effect.exit);
						assert.isTrue(Exit.isFailure(exit));
					}),
				),
			);
		}),
	);

	it.effect("a confirm that cannot mount leaves the warning for the caller to print", () =>
		Effect.gen(function* () {
			const files = yield* aheadFiles;
			return yield* withBundle(files, (root) =>
				Effect.scoped(
					Effect.gen(function* () {
						const session = yield* CliUiTest.session({ interactive: true });
						const shown = { clockWarning: false };
						const result = yield* syncWithConfirm(
							aheadOptions(root),
							false,
							() => Effect.fail(new NotInteractive()),
							shown,
						).pipe(Effect.provide(session.layer), Effect.provide(fakes(root)));
						assert.isDefined(result.clockBehind);
						assert.isFalse(shown.clockWarning);
					}),
				),
			);
		}),
	);
});
