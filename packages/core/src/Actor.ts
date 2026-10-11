import type { Brand } from "effect";
import { Schema } from "effect";

// D-18; concept-id-link-resolution-and-actor-grammar.md section 6.
const ACTOR_RE = /^(?:[^\s/:]+\/[^\s]+|[A-Za-z][A-Za-z0-9_-]*:[^\s]+)$/u;

/**
 * An OKF actor string: `<producer>/<version>`, `human:<id>`, `process:<id>`,
 * or any other `<prefix>:<id>` (the spec's `team:` examples).
 * @public
 */
export type Actor = string & Brand.Brand<"Actor">;

/**
 * Prefix classification; `other` drives lint `actor-prefix-unknown` (D-18).
 * @public
 */
export type ActorForm = "producer" | "human" | "process" | "other";

const isHuman = (actor: string): boolean => actor.startsWith("human:");

const form = (actor: string): ActorForm => {
	const colon = actor.indexOf(":");
	const slash = actor.indexOf("/");
	if (slash !== -1 && (colon === -1 || slash < colon)) return "producer";
	const prefix = colon === -1 ? "" : actor.slice(0, colon);
	return prefix === "human" ? "human" : prefix === "process" ? "process" : "other";
};

const GLOB_RE = /[*?]/u;
const ESCAPE_RE = /[.+^${}()|[\]\\/]/gu;

/** `*` is any run of non-whitespace, `?` one non-whitespace character; everything else is literal. */
const patternRegExp = (pattern: string): RegExp =>
	new RegExp(
		`^${[...pattern]
			.map((char) => (char === "*" ? "\\S*" : char === "?" ? "\\S" : char.replace(ESCAPE_RE, "\\$&")))
			.join("")}$`,
		"iu",
	);

const isPattern = (value: string): boolean => GLOB_RE.test(value);
const matches = (actor: string, pattern: string): boolean => patternRegExp(pattern).test(actor);
const allowed = (actor: string, humans: ReadonlyArray<string>): boolean =>
	humans.length === 0 || humans.some((pattern) => matches(actor, pattern));

/**
 * Branded, pattern-checked actor codec with prefix classification statics.
 * @public
 */
export const Actor: Schema.Codec<Actor, string> & {
	readonly isHuman: (actor: string) => boolean;
	readonly form: (actor: string) => ActorForm;
	/** True when the actor equals the pattern, case-insensitively; `*` and `?` are the only wildcards. */
	readonly matches: (actor: string, pattern: string) => boolean;
	/** True when `humans` is empty, else when the actor matches at least one entry. */
	readonly allowed: (actor: string, humans: ReadonlyArray<string>) => boolean;
	/** True when the value contains a glob character (`*` or `?`). */
	readonly isPattern: (value: string) => boolean;
} = Object.assign(
	Schema.String.pipe(
		Schema.check(
			Schema.isPattern(ACTOR_RE, { message: "Expected <producer>/<version> or <prefix>:<id> with no whitespace" }),
		),
		Schema.brand("Actor"),
	).annotate({
		title: "Actor",
		description:
			'An OKF actor: "<producer>/<version>" (e.g. "okfit/claude-code"), or "<prefix>:<id>" (e.g. "human:spencer", "process:ci").',
		examples: ["okfit/claude-code" as Actor, "human:spencer" as Actor, "process:ci" as Actor],
	}),
	{ isHuman, form, matches, allowed, isPattern },
);

/**
 * An `[actors].humans` entry: an exact actor id, or an id glob (`*`, `?`)
 * such as `human:spencer*`. Same grammar as {@link (Actor:variable)}; the
 * glob characters are already legal id characters.
 * @public
 */
export type ActorPattern = string & Brand.Brand<"ActorPattern">;

/**
 * Branded, pattern-checked `[actors].humans` entry codec.
 * @public
 */
export const ActorPattern: Schema.Codec<ActorPattern, string> = Schema.String.pipe(
	Schema.check(
		Schema.isPattern(ACTOR_RE, {
			message: "Expected <prefix>:<id> (globs * and ? allowed in the id) with no whitespace",
		}),
	),
	Schema.brand("ActorPattern"),
).annotate({
	title: "Actor or actor glob",
	description:
		'An actor id ("human:spencer") or an id glob ("human:spencer*"; * matches any run of characters, ? one), matched case-insensitively.',
	examples: ["human:spencer" as ActorPattern, "human:spencer*" as ActorPattern],
});
