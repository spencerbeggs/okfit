import { assert, describe, it } from "@effect/vitest";
import { CliEnv, CliLinks } from "@effected/cli";
import { CliUiTest } from "@effected/cli/ui/testing";
import { DateTime, Effect, Exit, Fiber, Layer, Option } from "effect";
import { reverifyStale } from "../../src/commands/stale-verify.js";
import { config, platform, read, withBundle } from "../utils/picker.js";

const NOW = DateTime.makeUnsafe("2026-10-09T00:00:00Z");

const stale = (title: string, extra = ""): string =>
	`---\ntype: Decision\ntitle: ${title}\nstale_after: 2026-01-01T00:00:00Z\n${extra}---\n\n# ${title}\n`;

const FILES: ReadonlyArray<readonly [string, string]> = [
	["decisions/old.md", stale("Old")],
	["decisions/fresh.md", "---\ntype: Decision\ntitle: Fresh\nstale_after: 2027-01-01T00:00:00Z\n---\n\n# Fresh\n"],
];

const start = (root: string, dryRun = false) =>
	Effect.gen(function* () {
		const session = yield* CliUiTest.session({ interactive: true });
		const fiber = yield* Effect.forkScoped(
			reverifyStale({ bundleRoot: root, projectRoot: root, config, now: NOW, at: NOW, dryRun }).pipe(
				Effect.provide(session.layer),
				Effect.provide(platform),
				Effect.provide(Layer.mergeAll(CliEnv.layerTest({ audience: "agent" }), CliLinks.layerTest("off"))),
			),
		);
		return { session, fiber };
	});

describe("reverifyStale", () => {
	it.effect("lists only stale concepts under the re-verify title", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root);
					const list = yield* session.next({ contains: "Re-verify which stale concepts?" });
					const frame = yield* list.plainFrame;
					assert.include(frame, "decisions/old");
					assert.notInclude(frame, "decisions/fresh");
					yield* list.press("escape");
					yield* Fiber.join(fiber).pipe(Effect.exit);
				}),
			),
		),
	);

	it.effect("space + enter + enter attests and rolls stale_after forward", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root);
					const list = yield* session.next({ contains: "Re-verify which stale concepts?" });
					yield* list.press("space", "enter");
					const confirm = yield* session.next({ contains: "Attest 1 concept(s) as human:ada?" });
					yield* confirm.press("enter");
					yield* Fiber.join(fiber);
					const text = yield* read(root, "decisions/old.md");
					assert.include(text, "stale_after: 2027-01-07T00:00:00Z");
					assert.include(text, "by: human:ada");
					assert.include(yield* session.stdout, "verified decisions/old by human:ada at 2026-10-09T00:00:00Z");
				}),
			),
		),
	);

	it.effect("--dry-run previews the whole entry and writes nothing", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const before = yield* read(root, "decisions/old.md");
					const { session, fiber } = yield* start(root, true);
					const list = yield* session.next({ contains: "Re-verify which stale concepts?" });
					yield* list.press("space", "enter");
					const confirm = yield* session.next({ contains: "Attest 1 concept(s)" });
					yield* confirm.press("enter");
					yield* Fiber.join(fiber);
					assert.strictEqual(yield* read(root, "decisions/old.md"), before);
					const out = yield* session.stdout;
					assert.include(out, "would verify decisions/old");
					assert.include(out, "  stale_after: 2027-01-07T00:00:00Z");
				}),
			),
		),
	);

	it.effect("Esc leaves the file byte-identical and fails Cancelled", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const before = yield* read(root, "decisions/old.md");
					const { session, fiber } = yield* start(root);
					const list = yield* session.next({ contains: "Re-verify which stale concepts?" });
					yield* list.press("space", "escape");
					const exit = yield* Fiber.await(fiber);
					assert.isTrue(Exit.isFailure(exit));
					assert.deepStrictEqual(CliUiTest.cancelReason(exit), Option.some("escape"));
					assert.strictEqual(yield* read(root, "decisions/old.md"), before);
				}),
			),
		),
	);

	it.effect("an empty stale set prints one line and mounts nothing", () =>
		withBundle([FILES[1] as readonly [string, string]], (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root);
					yield* Fiber.join(fiber);
					assert.strictEqual(yield* session.mounts, 0);
					assert.strictEqual(yield* session.stdout, "nothing to re-verify: no stale concepts\n");
				}),
			),
		),
	);
});
