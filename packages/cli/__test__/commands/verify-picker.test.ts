import { assert, describe, it } from "@effect/vitest";
import { CliUiTest } from "@effected/cli/ui/testing";
import type { Actor } from "@okfit/core";
import { runVerifyIds } from "@okfit/engine";
import { Effect, Exit, Fiber, Option } from "effect";
import { pickConcepts, pickerLabel } from "../../src/commands/verify-picker.js";
import { AT, FILES, config, platform, read, withBundle } from "../utils/picker.js";

const options = (root: string) => ({ bundleRoot: root, projectRoot: root, config });

/** Fork `pickConcepts` on a fresh session; the caller drives the screens and joins. */
const start = (root: string, interactive = true) =>
	Effect.gen(function* () {
		const session = yield* CliUiTest.session({ interactive });
		const fiber = yield* Effect.forkScoped(
			pickConcepts(options(root)).pipe(Effect.provide(session.layer), Effect.provide(platform)),
		);
		return { session, fiber };
	});

describe("pickConcepts", () => {
	it("labels a row compactly, counting only other attestations", () => {
		assert.strictEqual(
			pickerLabel({ id: "a", type: "T", status: "draft", title: null, description: null, otherAttestations: 0 }),
			"a  draft",
		);
		assert.strictEqual(
			pickerLabel({ id: "a", type: "T", status: "stable", title: null, description: null, otherAttestations: 2 }),
			"a  stable  2 other attestation(s)",
		);
	});

	it.effect("shows one section per type with labels and offers only what ada has not attested", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root);
					const list = yield* session.next({ contains: "Attest which concepts?" });
					const frame = yield* list.plainFrame;
					assert.include(frame, "Decision");
					assert.include(frame, "Module");
					assert.include(frame, "decisions/a  draft");
					assert.include(frame, "decisions/b  stable");
					assert.include(frame, "modules/m  stable  1 other attestation(s)");
					assert.notInclude(frame, "decisions/c");
					yield* list.press("escape");
					yield* Fiber.join(fiber).pipe(Effect.exit);
				}),
			),
		),
	);

	it.effect("space + enter + confirm resolves exactly the chosen ids; promote defaults on with drafts", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root);
					const list = yield* session.next({ contains: "Attest which concepts?" });
					yield* list.press("space", "down", "down", "space", "enter");
					const confirm = yield* session.next({ contains: "Attest 2 concept(s) as human:ada?" });
					assert.include(yield* confirm.plainFrame, "promote 1 draft(s) to stable");
					yield* confirm.press("enter");
					const picked = yield* Fiber.join(fiber);
					assert.deepStrictEqual(picked, {
						by: "human:ada" as Actor,
						ids: ["decisions/a", "modules/m"],
						promote: true,
					});
					assert.strictEqual(yield* session.mounts, 2);
				}),
			),
		),
	);

	it.effect("promote toggled off reports promote false; no drafts selected shows no toggle", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const first = yield* start(root);
					const list = yield* first.session.next({ contains: "Attest which concepts?" });
					yield* list.press("space", "enter");
					const confirm = yield* first.session.next({ contains: "promote 1 draft(s)" });
					yield* confirm.press("down", "space", "enter");
					assert.strictEqual((yield* Fiber.join(first.fiber))?.promote, false);
				}),
			),
		),
	);

	it.effect("selecting only stable concepts offers no promote toggle", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root);
					const list = yield* session.next({ contains: "Attest which concepts?" });
					yield* list.press("down", "space", "enter");
					const confirm = yield* session.next({ contains: "Attest 1 concept(s)" });
					assert.notInclude(yield* confirm.plainFrame, "promote");
					yield* confirm.press("enter");
					assert.deepStrictEqual((yield* Fiber.join(fiber))?.promote, false);
				}),
			),
		),
	);

	it.effect("an empty submit prints one line, mounts no confirm and resolves undefined", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root);
					const list = yield* session.next({ contains: "Attest which concepts?" });
					yield* list.press("enter");
					assert.isUndefined(yield* Fiber.join(fiber));
					assert.strictEqual(yield* session.mounts, 1);
					assert.strictEqual(yield* session.stdout, "nothing selected; nothing written\n");
				}),
			),
		),
	);

	it.effect("confirming no fails Cancelled(escape)", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root);
					const list = yield* session.next({ contains: "Attest which concepts?" });
					yield* list.press("space", "enter");
					const confirm = yield* session.next({ contains: "Attest 1 concept(s)" });
					yield* confirm.press({ char: "n" }, "enter");
					const exit = yield* Fiber.await(fiber);
					assert.isTrue(Exit.isFailure(exit));
					assert.deepStrictEqual(CliUiTest.cancelReason(exit), Option.some("escape"));
				}),
			),
		),
	);

	it.effect("Esc on the list cancels and leaves every file as it was", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const before = yield* Effect.forEach(FILES, ([name]) => read(root, name));
					const { session, fiber } = yield* start(root);
					const list = yield* session.next({ contains: "Attest which concepts?" });
					yield* list.press("space", "escape");
					const exit = yield* Fiber.await(fiber);
					assert.isTrue(Exit.isFailure(exit));
					assert.deepStrictEqual(CliUiTest.cancelReason(exit), Option.some("escape"));
					assert.deepStrictEqual(yield* Effect.forEach(FILES, ([name]) => read(root, name)), before);
				}),
			),
		),
	);

	it.effect("prints a single line and mounts nothing when ada has attested everything", () =>
		withBundle([["decisions/c.md", FILES[2]?.[1] ?? ""]], (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root);
					assert.isUndefined(yield* Fiber.join(fiber));
					assert.strictEqual(yield* session.mounts, 0);
					assert.strictEqual(
						yield* session.stdout,
						"nothing to verify: every require_verified concept is already attested by human:ada\n",
					);
				}),
			),
		),
	);

	it.effect("a non-interactive session fails NotInteractive and writes nothing", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(root, false);
					const exit = yield* Fiber.await(fiber);
					assert.isTrue(Exit.isFailure(exit));
					assert.strictEqual(yield* session.mounts, 0);
				}),
			),
		),
	);

	it.effect("the picked ids drive runVerifyIds: promote settles the draft, off keeps it", () =>
		withBundle(FILES, (root) =>
			Effect.gen(function* () {
				const base = { ...options(root), at: AT, ids: ["decisions/a", "decisions/b"] };
				yield* runVerifyIds({ ...base, dryRun: true, promote: true }).pipe(Effect.provide(platform));
				assert.notInclude(yield* read(root, "decisions/a.md"), "human:ada");
				yield* runVerifyIds({ ...base, dryRun: false, promote: false }).pipe(Effect.provide(platform));
				const kept = yield* read(root, "decisions/a.md");
				assert.include(kept, "status: draft");
				assert.include(kept, "human:ada");
				yield* runVerifyIds({ ...base, dryRun: false, promote: true }).pipe(Effect.provide(platform));
				assert.include(yield* read(root, "decisions/a.md"), "status: stable");
			}),
		),
	);
});
