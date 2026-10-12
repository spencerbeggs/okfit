import { writeFile } from "node:fs/promises";
import { assert, describe, it } from "@effect/vitest";
import { CliUiTest } from "@effected/cli/ui/testing";
import type { Actor } from "@okfit/core";
import { loadStaleCandidates, runVerifyIds } from "@okfit/engine";
import { Effect, Exit, Fiber, Option } from "effect";
import type { PickerSource } from "../../src/commands/verify-picker.js";
import { pickConcepts, pickerLabel } from "../../src/commands/verify-picker.js";
import {
	AT,
	DRIFT_EDIT,
	FILES,
	config,
	platform,
	read,
	repoPlatform,
	withBundle,
	withDriftedRepoBundle,
} from "../utils/picker.js";

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

/** As {@link start}, over a git repository (real history, so drifted rows preview a diff). */
const startInRepo = (root: string, size: { readonly columns: number; readonly rows: number }, source?: PickerSource) =>
	Effect.gen(function* () {
		yield* Effect.promise(() => import("../../src/commands/verify-preview.js"));
		const session = yield* CliUiTest.session(size);
		const fiber = yield* Effect.forkScoped(
			pickConcepts(options(root), source).pipe(Effect.provide(session.layer), Effect.provide(repoPlatform)),
		);
		return { session, fiber };
	});

describe("pickConcepts", () => {
	it("labels a row compactly, counting only other attestations", () => {
		assert.strictEqual(
			pickerLabel({
				id: "a",
				type: "T",
				status: "draft",
				title: null,
				description: null,
				otherAttestations: 0,
				integrity: "none",
				stale: false,
				path: "/b/a.md",
				boundAt: null,
			}),
			"a  draft",
		);
		assert.strictEqual(
			pickerLabel({
				id: "a",
				type: "T",
				status: "stable",
				title: null,
				description: null,
				otherAttestations: 2,
				integrity: "none",
				stale: false,
				path: "/b/a.md",
				boundAt: null,
			}),
			"a  stable  2 other attestation(s)",
		);
		assert.strictEqual(
			pickerLabel({
				id: "a",
				type: "T",
				status: "stable",
				title: null,
				description: null,
				otherAttestations: 0,
				integrity: "drifted",
				stale: false,
				path: "/b/a.md",
				boundAt: null,
			}),
			"a  stable  drifted",
		);
		assert.strictEqual(
			pickerLabel({
				id: "a",
				type: "T",
				status: "stable",
				title: null,
				description: null,
				otherAttestations: 0,
				integrity: "drifted",
				stale: true,
				path: "/b/a.md",
				boundAt: null,
			}),
			"a  stable  drifted  stale",
		);
		assert.strictEqual(
			pickerLabel({
				id: "a",
				type: "T",
				status: "stable",
				title: null,
				description: null,
				otherAttestations: 0,
				integrity: "none",
				stale: true,
				path: "/b/a.md",
				boundAt: null,
			}),
			"a  stable  stale",
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

	it.effect("with no drifted row the list is the stock MultiSelect: no preview pane", () =>
		withBundle(
			FILES.filter(([name]) => name !== "modules/m.md"),
			(root) =>
				Effect.scoped(
					Effect.gen(function* () {
						const { session, fiber } = yield* start(root);
						const list = yield* session.next({ contains: "Attest which concepts?" });
						const frame = yield* list.plainFrame;
						assert.include(frame, "decisions/a  draft");
						assert.notInclude(frame, "drifted");
						// The preview pane would say `not drifted` for this highlighted row.
						assert.notInclude(frame, "not drifted");
						// The stock view draws the highlighted row's detail under the list; the preview pane would not.
						assert.include(frame, "Alpha — first choice");
						yield* list.press("escape");
						yield* Fiber.join(fiber).pipe(Effect.exit);
					}),
				),
		),
	);

	it.effect("an unbound drifted row previews why there is no baseline, without reading git history", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					// `platform`'s Git fakes identity only: a history read would die, so this proves none happens.
					const { session, fiber } = yield* start(root);
					const list = yield* session.next({ contains: "Attest which concepts?" });
					assert.include(yield* list.plainFrame, "not drifted");
					yield* list.press("down", "down");
					const frame = yield* list.plainFrame;
					assert.include(frame, "modules/m  stable  1 other attestation(s)  drifted");
					assert.include(frame, "no baseline to compare: no integrity binding records what was verified");
					yield* list.press("escape");
					yield* Fiber.join(fiber).pipe(Effect.exit);
				}),
			),
		),
	);

	describe("with a drifted concept: the diff preview screen", () => {
		it.effect("moving the highlight changes the preview; submit resolves as the stock picker does", () =>
			withDriftedRepoBundle((root) =>
				Effect.scoped(
					Effect.gen(function* () {
						const { session, fiber } = yield* startInRepo(root, { columns: 140, rows: 30 });
						const screen = yield* session.next({ contains: "Attest which concepts?" });
						const first = yield* screen.plainFrame;
						// decisions/a is highlighted first: never verified, so nothing to diff.
						assert.include(first, "decisions/a  draft");
						assert.include(first, "decisions/c  stable  drifted");
						assert.include(first, "not drifted");
						assert.notInclude(first, "@@");
						yield* screen.press("down", "down");
						const drifted = yield* screen.plainFrame;
						assert.include(drifted, "changed since");
						assert.include(drifted, "@@");
						assert.include(drifted, `+${DRIFT_EDIT}`);
						assert.notInclude(drifted, "not drifted");
						// Back up one row: the preview follows the highlight.
						yield* screen.press("up");
						assert.notInclude(yield* screen.plainFrame, "@@");
						yield* screen.press("down", "space", "enter");
						const confirm = yield* session.next({ contains: "Attest 1 concept(s) as human:ada?" });
						assert.notInclude(yield* confirm.plainFrame, "promote");
						yield* confirm.press("enter");
						assert.deepStrictEqual(yield* Fiber.join(fiber), {
							by: "human:ada" as Actor,
							ids: ["decisions/c"],
							promote: false,
						});
					}),
				),
			),
		);

		it.effect("a narrow terminal stacks the preview below the list; a section toggle and a draft still promote", () =>
			withDriftedRepoBundle((root) =>
				Effect.scoped(
					Effect.gen(function* () {
						const { session, fiber } = yield* startInRepo(root, { columns: 60, rows: 30 });
						const screen = yield* session.next({ contains: "Attest which concepts?" });
						yield* screen.press("down", "down");
						const lines = (yield* screen.plainFrame).split("\n");
						const row = lines.findIndex((line) => line.includes("decisions/c  stable  drifted"));
						const hunk = lines.findIndex((line) => line.includes("@@"));
						assert.isAbove(row, -1);
						assert.isAbove(hunk, row);
						// The preview is below the list, not beside the row.
						assert.notInclude(lines[row], "@@");
						yield* screen.press({ char: "a" }, "enter");
						const confirm = yield* session.next({ contains: "Attest 3 concept(s) as human:ada?" });
						assert.include(yield* confirm.plainFrame, "promote 1 draft(s) to stable");
						yield* confirm.press("enter");
						assert.deepStrictEqual(yield* Fiber.join(fiber), {
							by: "human:ada" as Actor,
							ids: ["decisions/a", "decisions/b", "decisions/c"],
							promote: true,
						});
					}),
				),
			),
		);

		it.effect("q cancels the preview screen with escape", () =>
			withDriftedRepoBundle((root) =>
				Effect.scoped(
					Effect.gen(function* () {
						const { session, fiber } = yield* startInRepo(root, { columns: 140, rows: 30 });
						const screen = yield* session.next({ contains: "Attest which concepts?" });
						yield* screen.press({ char: "q" });
						const exit = yield* Fiber.await(fiber);
						assert.isTrue(Exit.isFailure(exit));
						assert.deepStrictEqual(CliUiTest.cancelReason(exit), Option.some("escape"));
					}),
				),
			),
		);

		it.effect("serves a custom source too (stale --verify): its title over the same preview", () =>
			withDriftedRepoBundle((root) =>
				Effect.scoped(
					Effect.gen(function* () {
						const source: PickerSource = {
							load: loadStaleCandidates({ ...options(root), now: AT }),
							empty: () => "nothing stale",
							message: "Re-verify which stale concepts?",
						};
						// The stale set is empty here, so add a stale_after to the drifted concept.
						const file = `${root}/decisions/c.md`;
						const text = yield* read(root, "decisions/c.md");
						yield* Effect.promise(() =>
							writeFile(file, text.replace("title: Gamma\n", "title: Gamma\nstale_after: 2026-01-01T00:00:00Z\n")),
						);
						const { session, fiber } = yield* startInRepo(root, { columns: 140, rows: 30 }, source);
						const screen = yield* session.next({ contains: "Re-verify which stale concepts?" });
						const frame = yield* screen.plainFrame;
						assert.include(frame, "decisions/c  stable  drifted  stale");
						assert.include(frame, "@@");
						yield* screen.press("escape");
						yield* Fiber.join(fiber).pipe(Effect.exit);
					}),
				),
			),
		);
	});
});
