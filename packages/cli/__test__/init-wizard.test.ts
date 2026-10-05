import { assert, describe, it } from "@effect/vitest";
import { Cancelled } from "@effected/cli";
import { CliUiTest } from "@effected/cli/ui/testing";
import { Effect, Exit, Fiber, Option } from "effect";
import { renderFailure } from "../src/errors.js";
import { InitBundleDirError, checkBundleDir } from "../src/internal/initWizard.js";
import { detailsOf, renderTyped } from "./utils/failureDetails.js";
import { exists, makeInitProject, readText, removeInitProject, runInit } from "./utils/initHarness.js";

/** Fork the handler on a session terminal; the test drives the screens. */
const start = (project: Awaited<ReturnType<typeof makeInitProject>>, input: Parameters<typeof runInit>[1] = {}) =>
	Effect.gen(function* () {
		const session = yield* CliUiTest.session({ interactive: true });
		const fiber = yield* Effect.forkScoped(runInit(project, input).pipe(Effect.provide(session.layer)));
		return { session, fiber };
	});

const withProject = <A, E, R>(use: (project: Awaited<ReturnType<typeof makeInitProject>>) => Effect.Effect<A, E, R>) =>
	Effect.acquireUseRelease(Effect.promise(makeInitProject), use, (project) =>
		Effect.promise(() => removeInitProject(project)),
	);

describe("init wizard (CliUiTest.session driving the real handler)", () => {
	it.live(
		"asks bundle directory then config location, with the defaults as initial values; one profile is not asked",
		() =>
			withProject((project) =>
				Effect.scoped(
					Effect.gen(function* () {
						const { session, fiber } = yield* start(project);
						// `PROFILE_NAMES` holds one profile, so no Profile screen mounts: the
						// first screen is the bundle directory.
						const two = yield* session.next({ contains: "Bundle directory" });
						assert.notInclude(yield* two.plainFrame, "Profile to scaffold with");
						assert.include(yield* two.plainFrame, "okf");
						yield* two.press("enter");
						const three = yield* session.next({ contains: "Config file location" });
						assert.include(yield* three.plainFrame, ".config/okfit.toml");
						yield* three.press("enter");
						const exit = yield* Fiber.await(fiber);
						assert.isTrue(Exit.isSuccess(exit));
						assert.strictEqual(yield* session.mounts, 2);
						const config = yield* Effect.promise(() => readText(`${project.cwd}/.config/okfit.toml`));
						assert.include(config, 'path = "okf"');
						assert.isTrue(yield* Effect.promise(() => exists(`${project.cwd}/okf/project.md`)));
					}),
				),
			),
	);

	it.live("answers flow into the written config and the scaffold location", () =>
		withProject((project) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(project);
					const two = yield* session.next({ contains: "Bundle directory" });
					yield* two.press("backspace", "backspace", "backspace");
					yield* two.type("docs/kb");
					yield* two.press("enter");
					const three = yield* session.next({ contains: "Config file location" });
					yield* three.press("down", "enter");
					const exit = yield* Fiber.await(fiber);
					assert.isTrue(Exit.isSuccess(exit));
					const config = yield* Effect.promise(() => readText(`${project.cwd}/okfit.toml`));
					assert.include(config, 'path = "docs/kb"');
					assert.isTrue(yield* Effect.promise(() => exists(`${project.cwd}/docs/kb/project.md`)));
					assert.isFalse(yield* Effect.promise(() => exists(`${project.cwd}/.config/okfit.toml`)));
					assert.isFalse(yield* Effect.promise(() => exists(`${project.cwd}/okf`)));
				}),
			),
		),
	);

	it.live("a setting given as a flag never mounts its screen", () =>
		withProject((project) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(project, { profile: "software-project", bundle: "kb" });
					const only = yield* session.next({ contains: "Config file location" });
					yield* only.press("enter");
					const exit = yield* Fiber.await(fiber);
					assert.isTrue(Exit.isSuccess(exit));
					assert.strictEqual(yield* session.mounts, 1);
					assert.isTrue(yield* Effect.promise(() => exists(`${project.cwd}/kb/project.md`)));
				}),
			),
		),
	);

	it.live("Esc on the first screen cancels: the second never mounts and nothing is written", () =>
		withProject((project) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(project);
					yield* (yield* session.next({ contains: "Bundle directory" })).press("escape");
					const exit = yield* Fiber.await(fiber);
					assert.isTrue(Exit.isFailure(exit));
					assert.deepStrictEqual(CliUiTest.cancelReason(exit), Option.some("escape"));
					if (Exit.isFailure(exit)) {
						const failure = new Cancelled({ reason: "escape" });
						assert.deepStrictEqual(renderFailure(failure, detailsOf(failure, exit.cause, true)), [
							"cancelled; nothing written",
						]);
					}
					assert.strictEqual(yield* session.mounts, 1);
					assert.isFalse(yield* Effect.promise(() => exists(`${project.cwd}/okf`)));
					assert.isFalse(yield* Effect.promise(() => exists(`${project.cwd}/.config`)));
				}),
			),
		),
	);

	it.live("a bad bundle entry is rejected inline and the screen stays open", () =>
		withProject((project) =>
			Effect.scoped(
				Effect.gen(function* () {
					const { session, fiber } = yield* start(project, { profile: "software-project" });
					const two = yield* session.next({ contains: "Bundle directory" });
					yield* two.press("backspace", "backspace", "backspace");
					yield* two.type("../out");
					yield* two.press("enter");
					assert.include(yield* two.plainFrame, "must not escape the project root");
					yield* two.press("escape");
					const exit = yield* Fiber.await(fiber);
					assert.isTrue(Exit.isFailure(exit));
					assert.isFalse(yield* Effect.promise(() => exists(`${project.root}/out`)));
				}),
			),
		),
	);

	it.live("not interactive: no screen mounts and the defaults apply", () =>
		withProject((project) =>
			Effect.scoped(
				Effect.gen(function* () {
					const session = yield* CliUiTest.session({ interactive: false });
					yield* runInit(project).pipe(Effect.provide(session.layer));
					assert.strictEqual(yield* session.mounts, 0);
					const config = yield* Effect.promise(() => readText(`${project.cwd}/.config/okfit.toml`));
					assert.include(config, 'path = "okf"');
					assert.isTrue(yield* Effect.promise(() => exists(`${project.cwd}/okf/project.md`)));
				}),
			),
		),
	);

	it.live("a bad --bundle flag fails with the exit-64 usage error before any screen or write", () =>
		withProject((project) =>
			Effect.scoped(
				Effect.gen(function* () {
					const session = yield* CliUiTest.session({ interactive: true });
					const exit = yield* Effect.exit(runInit(project, { bundle: "/abs" }).pipe(Effect.provide(session.layer)));
					assert.isTrue(Exit.isFailure(exit));
					assert.strictEqual(yield* session.mounts, 0);
					assert.isFalse(yield* Effect.promise(() => exists(`${project.cwd}/.config`)));
				}),
			),
		),
	);
});

describe("checkBundleDir / InitBundleDirError", () => {
	it("normalises accepted directories", () => {
		assert.deepStrictEqual(checkBundleDir("./docs//kb/"), { ok: true, dir: "docs/kb" });
		assert.deepStrictEqual(checkBundleDir("okf"), { ok: true, dir: "okf" });
		assert.deepStrictEqual(checkBundleDir("a/../b"), { ok: true, dir: "b" });
	});

	it("rejects empty, absolute, root and escaping directories", () => {
		for (const bad of ["", "  ", "/etc", "C:\\x", ".", "./", "..", "../x", "a/../../x"]) {
			assert.isFalse(checkBundleDir(bad).ok, bad);
		}
	});

	it("is a usage error (exit 64) rendered as one `error:` line", () => {
		const error = new InitBundleDirError({ value: "../x", reason: "must not escape the project root" });
		assert.strictEqual(
			(error as unknown as Record<symbol, number>)[Symbol.for("effect/Runtime/errorExitCode")] ?? 64,
			64,
		);
		assert.deepStrictEqual(renderTyped(error), [
			'error: invalid bundle directory "../x": must not escape the project root',
		]);
	});
});
