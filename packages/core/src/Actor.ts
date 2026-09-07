import type { Brand } from "effect";
import { Schema } from "effect";

// D-18; concept-id-link-resolution-and-actor-grammar.md section 6.
const ACTOR_RE = /^(?:[^\s/:]+\/[^\s]+|[A-Za-z][A-Za-z0-9_-]*:[^\s]+)$/;

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

/**
 * Branded, pattern-checked actor codec with prefix classification statics.
 * @public
 */
export const Actor: Schema.Codec<Actor, string> & {
	readonly isHuman: (actor: string) => boolean;
	readonly form: (actor: string) => ActorForm;
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
	{ isHuman, form },
);
