import type { GitCommandError, NotARepositoryError, UnknownRefError } from "@effected/git";
import { Git } from "@effected/git";
import { FrontmatterSource } from "@effected/markdown";
import { Actor, OkfitConfig } from "@okfit/core";
import type { PlatformError } from "effect";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import type { GitHistoryError } from "./GitHistory.js";

/**
 * Who is writing now. Explicit, never read from the environment (P-16).
 *
 * @public
 */
export type Writer = "agent" | "human";

/**
 * git has no identity to derive a `human:` actor from (P-13 step 4).
 * `userName` and `userEmail` are the trimmed `configGet` answers when git had
 * them and absent keys otherwise (decision 53: not `name`/`email`, since every
 * Effect error class carries the class name on its own prototype and a field
 * literally named `name` would shadow `error.name` when present); test for
 * git's answer with `Object.hasOwn(error, "userName")`.
 *
 * @public
 */
export class HumanActorUnresolvedError extends Schema.TaggedError<HumanActorUnresolvedError>()(
	"HumanActorUnresolvedError",
	{
		userName: Schema.optionalKey(Schema.String),
		userEmail: Schema.optionalKey(Schema.String),
	},
) {
	override get message(): string {
		return "git has no user.name or user.email to derive a human actor from; set one or add actors.humans";
	}
}

/**
 * The writer is an agent but `actors.agent` is not configured (P-17); the
 * profile never sets it.
 *
 * @public
 */
export class AgentActorUnconfiguredError extends Schema.TaggedError<AgentActorUnconfiguredError>()(
	"AgentActorUnconfiguredError",
	{},
) {
	override get message(): string {
		return "writer is agent but actors.agent is not configured";
	}
}

/**
 * Options for {@link Derivation.generatedAt} (P-39).
 *
 * @public
 */
export interface GeneratedAtOptions {
	/** ABSOLUTE path to the concept file on disk. */
	readonly file: string;
	/** Reserved (P-48): accepted and ignored in phase 1; no key affects the walk. */
	readonly config?: OkfitConfig;
}

/**
 * Everything {@link Derivation.generatedAt} can fail with: profiles' own
 * `GitHistoryError`, the `@effected/git` peer's errors (P-12), and the
 * `PlatformError` of `realPath`/`readFileString` on `file`.
 *
 * @public
 */
export type GeneratedAtError =
	| GitHistoryError
	| GitCommandError
	| NotARepositoryError
	| UnknownRefError
	| PlatformError.PlatformError;

/**
 * Options for {@link Derivation.generatedBy} (P-16, P-45).
 *
 * @public
 */
export interface GeneratedByOptions {
	readonly writer: Writer;
	/** Any directory inside the repository; every `Git` member takes a cwd and profiles never reads `process.cwd()`. */
	readonly cwd: string;
	/** Merged or raw; only `actors` is read. */
	readonly config: OkfitConfig;
}

/**
 * Everything {@link Derivation.generatedBy} can fail with.
 *
 * @public
 */
export type GeneratedByError =
	| AgentActorUnconfiguredError
	| HumanActorUnresolvedError
	| GitCommandError
	| NotARepositoryError
	| UnknownRefError;

/**
 * Trimmed `user.name` / `user.email` as `Git.configGet` answers them; a key is absent when git has no value.
 *
 * @public
 */
export interface GitIdentity {
	readonly name?: string;
	readonly email?: string;
}

const HUMAN_PREFIX = "human:";
const FALLBACK_STALE_AFTER = Duration.days(90);
const decodeActor = Schema.decodeSync(Actor);

// P-6: CRLF and lone CR to LF, then trailing whitespace at end of text removed.
const normalise = (text: string): string => text.replace(/\r\n?/g, "\n").replace(/\s+$/, "");

// MD/index.d.ts:2306; body is source.slice(bodyOffset) (:2248-2254).
const body = (text: string): string => normalise(FrontmatterSource.split(text).body);

/** The text before the first `@` (the whole value when there is none), or undefined when empty or containing whitespace. */
const localPartOf = (email: string | undefined): string | undefined => {
	if (email === undefined) return undefined;
	const at = email.indexOf("@");
	const local = at === -1 ? email : email.slice(0, at);
	return local.length > 0 && !/\s/.test(local) ? local : undefined;
};

/** P-13 step 3: lower-case, runs outside `[a-z0-9._-]` to `-`, leading and trailing `-` trimmed. */
const slugOf = (name: string | undefined): string | undefined => {
	if (name === undefined) return undefined;
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug : undefined;
};

const humanActorId = (identity: GitIdentity, humans: ReadonlyArray<Actor>): Option.Option<Actor> => {
	const local = localPartOf(identity.email);
	const slug = slugOf(identity.name);
	const candidates = [local, slug]
		.filter((candidate): candidate is string => candidate !== undefined)
		.map((candidate) => candidate.toLowerCase());
	// (1) a configured human whose id matches a candidate case-insensitively; config spelling wins (P-14).
	for (const entry of humans) {
		if (!entry.startsWith(HUMAN_PREFIX)) continue;
		if (candidates.includes(entry.slice(HUMAN_PREFIX.length).toLowerCase())) return Option.some(entry);
	}
	// (2) the email local part, (3) the name slug, (4) none. Both are whitespace-free and non-empty by construction.
	if (local !== undefined) return Option.some(decodeActor(`${HUMAN_PREFIX}${local}`));
	if (slug !== undefined) return Option.some(decodeActor(`${HUMAN_PREFIX}${slug}`));
	return Option.none();
};

// P-19: DateTime.addDuration takes Duration.Input, which includes Duration itself (EF/Duration.ts:172).
const staleAfter = (from: DateTime.Utc, config: OkfitConfig): DateTime.Utc =>
	DateTime.addDuration(
		from,
		config.lifecycle?.default_stale_after ??
			OkfitConfig.DEFAULTS.lifecycle?.default_stale_after ??
			FALLBACK_STALE_AFTER,
	);

/**
 * Spec 5.4 derivation rules for the `software-project` profile, package-global
 * (P-38). Pure members take every input as an argument; effectful members
 * require `Git`, `GitHistory` and, for the worktree read, `FileSystem` and
 * `Path` (P-30). Never writes, never reads `generated.by` (P-40).
 *
 * @public
 */
export class Derivation {
	private constructor() {}

	/**
	 * `FrontmatterSource.split(text).body`, then CRLF and lone CR to LF, then trailing whitespace at end of
	 * text removed (P-6). Pure. Applied to both sides of every comparison so `core.autocrlf` worktrees compare clean.
	 */
	static readonly body: (text: string) => string = body;

	/**
	 * P-13 / P-14, pure. Candidates: the email local part (returned as written, lower-cased only for matching)
	 * and the `user.name` slug. Order, first hit wins: (1) a `human:` entry of `humans` whose id equals a
	 * candidate case-insensitively, returned verbatim; (2) `human:<local>`; (3) `human:<slug>`; (4) none.
	 * The result is branded through core's `Actor` codec and always passes it.
	 */
	static readonly humanActorId: (identity: GitIdentity, humans: ReadonlyArray<Actor>) => Option.Option<Actor> =
		humanActorId;

	/**
	 * Spec 5.4 rule 1 (P-16, P-45). `"agent"`: `config.actors.agent`, else {@link AgentActorUnconfiguredError}
	 * (P-17). `"human"`: `Git.configGet(cwd, "user.name")` and `Git.configGet(cwd, "user.email")` in merged
	 * scope (P-15) through {@link Derivation.humanActorId}; none is {@link HumanActorUnresolvedError}.
	 * Answers only "who is writing now" (P-40).
	 */
	static readonly generatedBy: (options: GeneratedByOptions) => Effect.Effect<Actor, GeneratedByError, Git> = Effect.fn(
		"Derivation.generatedBy",
	)(function* (options: GeneratedByOptions) {
		if (options.writer === "agent") {
			const agent = options.config.actors?.agent;
			if (agent === undefined) return yield* new AgentActorUnconfiguredError({});
			return agent;
		}
		const git = yield* Git;
		const name = Option.getOrUndefined(yield* git.configGet(options.cwd, "user.name"));
		const email = Option.getOrUndefined(yield* git.configGet(options.cwd, "user.email"));
		const identity: GitIdentity = {
			...(name === undefined ? {} : { name }),
			...(email === undefined ? {} : { email }),
		};
		const resolved = humanActorId(identity, options.config.actors?.humans ?? []);
		if (Option.isNone(resolved))
			return yield* new HumanActorUnresolvedError({
				...(identity.name === undefined ? {} : { userName: identity.name }),
				...(identity.email === undefined ? {} : { userEmail: identity.email }),
			});
		return resolved.value;
	});

	/**
	 * P-19, pure: `from` plus `config.lifecycle.default_stale_after`, falling back to `OkfitConfig.DEFAULTS`'
	 * 90 days. `from` is the caller's: `generated.at` when committed, else its own `now`.
	 */
	static readonly staleAfter: (from: DateTime.Utc, config: OkfitConfig) => DateTime.Utc = staleAfter;
}
