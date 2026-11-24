import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { CliUiTest } from "@effected/cli-kit/ui/testing";
import { Git } from "@effected/git";
import { ActorPattern, OkfitConfig } from "@okfit/core";
import { VerifyStatusUnknownError } from "@okfit/engine";
import { HumanActorNotAllowedError } from "@okfit/profiles";
import { DateTime, Effect, Fiber, Layer, Schema } from "effect";
import { confirmReverify } from "../../src/commands/verify-confirm.js";
import { FILES, withBundle } from "../utils/picker.js";
import { TestPlatform } from "../utils/platform.js";

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" };

const git = (cwd: string, args: ReadonlyArray<string>, date?: string): void => {
	execFileSync("git", [...args], {
		cwd,
		env: date === undefined ? GIT_ENV : { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
		stdio: "pipe",
	});
};

/** `decisions/c` is bound at 2026-09-01; this commits it the day before, then edits its body, so it has drifted. */
const driftedRepo = (root: string) =>
	Effect.gen(function* () {
		git(root, ["-c", "init.defaultBranch=main", "init", "-q"]);
		git(root, ["config", "user.name", "Ada"]);
		git(root, ["config", "user.email", "ada@example.com"]);
		git(root, ["config", "commit.gpgsign", "false"]);
		git(root, ["add", "-A"]);
		git(root, ["commit", "-q", "-m", "bundle"], "2026-08-31T00:00:00Z");
		yield* Effect.promise(() => appendFile(join(root, "decisions", "c.md"), "\nA new sentence.\n"));
	});

const platform = Layer.mergeAll(Git.layer, TestPlatform).pipe(Layer.provide(TestPlatform));
const layer = Layer.mergeAll(platform, TestPlatform);

const NOW = DateTime.makeUnsafe("2026-10-10T00:00:00Z");

const start = (
	root: string,
	interactive: boolean,
	extra: { noDiff?: boolean; dryRun?: boolean; id?: string; config?: OkfitConfig; status?: "stable" | "draft" } = {},
) =>
	Effect.gen(function* () {
		const session = yield* CliUiTest.session({ interactive });
		const fiber = yield* Effect.forkScoped(
			confirmReverify({
				id: extra.id ?? "decisions/c",
				bundleRoot: root,
				projectRoot: root,
				config: extra.config ?? OkfitConfig.DEFAULTS,
				now: NOW,
				noDiff: extra.noDiff ?? false,
				dryRun: extra.dryRun ?? false,
				...(extra.status === undefined ? {} : { status: extra.status }),
			}).pipe(Effect.provide(session.layer), Effect.provide(layer)),
		);
		return { session, fiber };
	});

describe("confirmReverify", () => {
	it.live("a drifted concept shows the patch and asks; n then enter declines", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					yield* driftedRepo(root);
					const { session, fiber } = yield* start(root, true);
					const confirm = yield* session.next({ contains: "Re-verify decisions/c?" });
					const out = yield* session.stdout;
					assert.include(out, "+A new sentence.");
					assert.include(out, "changed since");
					yield* confirm.type("n");
					yield* confirm.press("enter");
					assert.isFalse(yield* Fiber.join(fiber));
				}),
			),
		),
	);

	it.live("y then enter proceeds", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					yield* driftedRepo(root);
					const { session, fiber } = yield* start(root, true);
					const confirm = yield* session.next({ contains: "Re-verify decisions/c?" });
					yield* confirm.type("y");
					yield* confirm.press("enter");
					assert.isTrue(yield* Fiber.join(fiber));
				}),
			),
		),
	);

	it.live("--no-diff, --dry-run, a non-interactive run and a concept that has not drifted never prompt", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					yield* driftedRepo(root);
					for (const [interactive, extra] of [
						[true, { noDiff: true }],
						[true, { dryRun: true }],
						[false, {}],
						[true, { id: "decisions/b" }],
					] as const) {
						const { session, fiber } = yield* start(root, interactive, extra);
						assert.isTrue(yield* Fiber.join(fiber));
						assert.notInclude(yield* session.stdout, "Re-verify");
						assert.notInclude(yield* session.stdout, "+A new sentence.");
					}
				}),
			),
		),
	);

	it.live("a drifted concept outside a repository says why there is no patch, and still asks", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					yield* Effect.promise(() => appendFile(join(root, "decisions", "c.md"), "\nA new sentence.\n"));
					// Outside a repository there is no user.name; okfit.actor supplies the identity through git's env config.
					yield* Effect.acquireUseRelease(
						Effect.sync(() => {
							const saved = [
								process.env.GIT_CONFIG_COUNT,
								process.env.GIT_CONFIG_KEY_0,
								process.env.GIT_CONFIG_VALUE_0,
							];
							process.env.GIT_CONFIG_COUNT = "1";
							process.env.GIT_CONFIG_KEY_0 = "okfit.actor";
							process.env.GIT_CONFIG_VALUE_0 = "human:ada";
							return saved;
						}),
						() =>
							Effect.gen(function* () {
								const { session, fiber } = yield* start(root, true);
								const confirm = yield* session.next({ contains: "Re-verify decisions/c?" });
								assert.include(yield* session.stdout, "no baseline to compare: not-a-repository");
								yield* confirm.type("n");
								yield* confirm.press("enter");
								assert.isFalse(yield* Fiber.join(fiber));
							}),
						(saved) =>
							Effect.sync(() => {
								const keys = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"] as const;
								keys.forEach((key, index) => {
									const value = saved[index];
									if (value === undefined) delete process.env[key];
									else process.env[key] = value;
								});
							}),
					);
				}),
			),
		),
	);

	it.live("an unlisted human is refused before any patch or prompt is shown", () =>
		withBundle(FILES, (root) =>
			Effect.scoped(
				Effect.gen(function* () {
					yield* driftedRepo(root);
					const config: OkfitConfig = {
						...OkfitConfig.DEFAULTS,
						actors: { humans: [Schema.decodeUnknownSync(ActorPattern)("human:grace")] },
					};
					const { session, fiber } = yield* start(root, true, { config });
					const exit = yield* Fiber.await(fiber);
					assert.isTrue(exit._tag === "Failure");
					const out = yield* session.stdout;
					assert.notInclude(out, "Re-verify");
					assert.notInclude(out, "+A new sentence.");
					assert.notInclude(out, "changed since");
					if (exit._tag === "Failure") {
						const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
						assert.instanceOf(failure?._tag === "Fail" ? failure.error : undefined, HumanActorNotAllowedError);
					}
				}),
			),
		),
	);
});

describe("confirmReverify and a status outside the vocabulary (OKF 0.3 5.4)", () => {
	/** `FILES` with `decisions/c` (drifted once edited) carrying `status`. */
	const withStatus = (status: string): typeof FILES =>
		FILES.map(([name, text]) =>
			name === "decisions/c.md"
				? [name, text.replace("title: Gamma\n", `title: Gamma\nstatus: ${status}\n`)]
				: [name, text],
		);

	it.live("refuses before the diff and the prompt; --stable, and the same concept at status stable, still prompt", () =>
		Effect.gen(function* () {
			yield* withBundle(withStatus("archived"), (root) =>
				Effect.scoped(
					Effect.gen(function* () {
						yield* driftedRepo(root);
						const { session, fiber } = yield* start(root, true);
						const exit = yield* Fiber.await(fiber);
						assert.isTrue(exit._tag === "Failure");
						if (exit._tag === "Failure") {
							const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
							const error = failure?._tag === "Fail" ? failure.error : undefined;
							assert.instanceOf(error, VerifyStatusUnknownError);
							assert.strictEqual((error as VerifyStatusUnknownError).status, "archived");
						}
						const out = yield* session.stdout;
						assert.notInclude(out, "Re-verify");
						assert.notInclude(out, "+A new sentence.");
						assert.notInclude(out, "changed since");
					}),
				),
			);
			// control: --stable replaces the status, so the drifted concept is shown and asked about
			yield* withBundle(withStatus("archived"), (root) =>
				Effect.scoped(
					Effect.gen(function* () {
						yield* driftedRepo(root);
						const { session, fiber } = yield* start(root, true, { status: "stable" });
						const confirm = yield* session.next({ contains: "Re-verify decisions/c?" });
						yield* confirm.type("y");
						yield* confirm.press("enter");
						assert.isTrue(yield* Fiber.join(fiber));
					}),
				),
			);
			// control: the same concept once its status is stable
			yield* withBundle(withStatus("stable"), (root) =>
				Effect.scoped(
					Effect.gen(function* () {
						yield* driftedRepo(root);
						const { session, fiber } = yield* start(root, true);
						const confirm = yield* session.next({ contains: "Re-verify decisions/c?" });
						yield* confirm.type("y");
						yield* confirm.press("enter");
						assert.isTrue(yield* Fiber.join(fiber));
					}),
				),
			);
		}),
	);
});
