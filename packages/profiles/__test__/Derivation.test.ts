import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { Actor, OkfitConfig } from "@okfit/core";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { AgentActorUnconfiguredError, Derivation, HumanActorUnresolvedError } from "../src/Derivation.js";
import { identityGit } from "./utils/derivation.js";

const actor = Schema.decodeUnknownSync(Actor);
const utc = (iso: string): number => DateTime.toEpochMillis(DateTime.makeUnsafe(iso));
const from = DateTime.makeUnsafe("2026-03-01T08:00:00Z");

describe("Derivation.body", () => {
	it("strips the frontmatter block, normalises CRLF and CR to LF, and trims trailing whitespace (P-6)", () => {
		assert.strictEqual(Derivation.body("---\ntitle: x\n---\r\nline one\r\nline two\r\n\r\n"), "line one\nline two");
		assert.strictEqual(Derivation.body("line one\rline two \n"), "line one\nline two");
		assert.strictEqual(Derivation.body("---\ntitle: x\n---"), "");
		assert.strictEqual(Derivation.body("---\ntitle: x\n---\n\n# Body\n"), "\n# Body");
		assert.strictEqual(Derivation.body("no frontmatter\n"), "no frontmatter");
	});
});

describe("Derivation.humanActorId (P-13, P-14)", () => {
	it("returns the config spelling on a case-insensitive match of the email local part", () => {
		const result = Derivation.humanActorId({ name: "C. Spencer Beggs", email: "Spencer@beggs.codes" }, [
			actor("human:spencer"),
		]);
		assert.deepStrictEqual(result, Option.some("human:spencer"));
		const spelled = Derivation.humanActorId({ email: "spencer@beggs.codes" }, [actor("human:Spencer")]);
		assert.deepStrictEqual(spelled, Option.some("human:Spencer"));
	});
	it("matches a config entry against the name slug when there is no email", () => {
		const result = Derivation.humanActorId({ name: "C. Spencer Beggs" }, [actor("human:C.-Spencer-Beggs")]);
		assert.deepStrictEqual(result, Option.some("human:C.-Spencer-Beggs"));
	});
	it("ignores config entries that are not human: prefixed", () => {
		const result = Derivation.humanActorId({ email: "spencer@beggs.codes" }, [
			actor("team:spencer"),
			actor("process:spencer"),
		]);
		assert.deepStrictEqual(result, Option.some("human:spencer"));
	});
	it("falls back to the email local part when no config entry matches", () => {
		const result = Derivation.humanActorId({ name: "C. Spencer Beggs", email: "spencer@beggs.codes" }, [
			actor("human:cspencer"),
		]);
		assert.deepStrictEqual(result, Option.some("human:spencer"));
		assert.deepStrictEqual(Derivation.humanActorId({ email: "spencer" }, []), Option.some("human:spencer"));
	});
	it("slugs user.name when there is no usable email", () => {
		assert.deepStrictEqual(
			Derivation.humanActorId({ name: "C. Spencer Beggs" }, []),
			Option.some("human:c.-spencer-beggs"),
		);
		assert.deepStrictEqual(
			Derivation.humanActorId({ name: "Jane Q. O'Brien-Smith", email: "@example.com" }, []),
			Option.some("human:jane-q.-o-brien-smith"),
		);
		assert.deepStrictEqual(
			Derivation.humanActorId({ name: "  Ada   Lovelace  " }, []),
			Option.some("human:ada-lovelace"),
		);
	});
	it("is none when neither name nor email yields a candidate", () => {
		assert.deepStrictEqual(Derivation.humanActorId({}, [actor("human:spencer")]), Option.none());
		assert.deepStrictEqual(Derivation.humanActorId({ name: "!!!", email: "@example.com" }, []), Option.none());
		assert.deepStrictEqual(Derivation.humanActorId({ email: "first last@example.com" }, []), Option.none());
	});
	it("always yields a value core's Actor codec accepts", () => {
		for (const identity of [
			{ name: "C. Spencer Beggs" },
			{ email: "jsmith@acme.example" },
			{ name: "x y", email: "a@b" },
		]) {
			const result = Derivation.humanActorId(identity, []);
			assert.isTrue(Option.isSome(result));
			if (Option.isSome(result)) {
				assert.strictEqual(actor(result.value), result.value);
				assert.isTrue(Actor.isHuman(result.value));
			}
		}
	});
});

describe("Derivation.generatedBy (P-16, P-17)", () => {
	it.effect("agent: returns actors.agent without touching git", () =>
		Effect.gen(function* () {
			const config: OkfitConfig = { actors: { agent: actor("okfit/claude-code") }, extensions: {} };
			const by = yield* Derivation.generatedBy({ writer: "agent", cwd: "/repo", config });
			assert.strictEqual(by, "okfit/claude-code");
		}).pipe(Effect.provide(Git.layerTest({}))),
	);
	it.effect("agent: fails AgentActorUnconfiguredError when actors.agent is unset", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				Derivation.generatedBy({ writer: "agent", cwd: "/repo", config: OkfitConfig.DEFAULTS }),
			);
			assert.instanceOf(error, AgentActorUnconfiguredError);
			assert.strictEqual(error._tag, "AgentActorUnconfiguredError");
			assert.strictEqual(error.message, "writer is agent but actors.agent is not configured");
		}).pipe(Effect.provide(Git.layerTest({}))),
	);
	it.effect("human: reads user.name and user.email in merged scope and derives the local part", () =>
		Effect.gen(function* () {
			const calls: Array<{ readonly key: string; readonly options: unknown }> = [];
			const git = identityGit({ "user.name": "Okfit Test", "user.email": "okfit-test@example.com" }, calls);
			const by = yield* Derivation.generatedBy({ writer: "human", cwd: "/repo", config: OkfitConfig.DEFAULTS }).pipe(
				Effect.provide(git),
			);
			assert.strictEqual(by, "human:okfit-test");
			assert.deepStrictEqual(
				calls.map((call) => call.key),
				["user.name", "user.email"],
			);
			assert.isTrue(calls.every((call) => call.options === undefined));
		}),
	);
	it.effect("human: config.actors.humans wins with its own spelling", () =>
		Effect.gen(function* () {
			const git = identityGit({ "user.email": "okfit-test@example.com" });
			const config: OkfitConfig = { actors: { humans: [actor("human:Okfit-Test")] }, extensions: {} };
			const by = yield* Derivation.generatedBy({ writer: "human", cwd: "/repo", config }).pipe(Effect.provide(git));
			assert.strictEqual(by, "human:Okfit-Test");
		}),
	);
	it.effect("human: fails HumanActorUnresolvedError carrying what git answered", () =>
		Effect.gen(function* () {
			const nothing = yield* Effect.flip(
				Derivation.generatedBy({ writer: "human", cwd: "/repo", config: OkfitConfig.DEFAULTS }).pipe(
					Effect.provide(identityGit({})),
				),
			);
			assert.instanceOf(nothing, HumanActorUnresolvedError);
			// Decision 53: fields are userName/userEmail, not name/email, so error.name always reads the class name. (checked)
			assert.isFalse(Object.hasOwn(nothing, "userName"));
			assert.isFalse(Object.hasOwn(nothing, "userEmail"));
			assert.strictEqual(nothing.userEmail, undefined);
			assert.strictEqual(
				nothing.message,
				"git has no user.name or user.email to derive a human actor from; set one or add actors.humans",
			);
			const unusable = yield* Effect.flip(
				Derivation.generatedBy({ writer: "human", cwd: "/repo", config: { extensions: {} } }).pipe(
					Effect.provide(identityGit({ "user.name": "!!!" })),
				),
			);
			assert.instanceOf(unusable, HumanActorUnresolvedError);
			assert.isTrue(Object.hasOwn(unusable, "userName"));
			assert.strictEqual(unusable.userName, "!!!");
			assert.isFalse(Object.hasOwn(unusable, "userEmail"));
		}),
	);
});

describe("Derivation.staleAfter (P-19)", () => {
	it("adds lifecycle.default_stale_after, falling back to DEFAULTS' 90 days", () => {
		assert.strictEqual(
			DateTime.toEpochMillis(Derivation.staleAfter(from, OkfitConfig.DEFAULTS)),
			utc("2026-05-30T08:00:00Z"),
		);
		const thirty: OkfitConfig = { lifecycle: { default_stale_after: Duration.days(30) }, extensions: {} };
		assert.strictEqual(DateTime.toEpochMillis(Derivation.staleAfter(from, thirty)), utc("2026-03-31T08:00:00Z"));
		assert.strictEqual(
			DateTime.toEpochMillis(Derivation.staleAfter(from, { extensions: {} })),
			utc("2026-05-30T08:00:00Z"),
		);
		assert.strictEqual(
			DateTime.toEpochMillis(Derivation.staleAfter(from, { lifecycle: {}, extensions: {} })),
			DateTime.toEpochMillis(DateTime.addDuration(from, OkfitConfig.DEFAULTS.lifecycle!.default_stale_after!)),
		);
		assert.isTrue(Duration.equals(OkfitConfig.DEFAULTS.lifecycle!.default_stale_after!, Duration.days(90)));
	});
});
