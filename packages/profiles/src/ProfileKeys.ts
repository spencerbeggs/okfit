import { OKFIT_KEY_PREFIX } from "@okfit/core";

/**
 * The names of the frontmatter fields the software-project profile declares on
 * its built-in types, in declaration order.
 * @public
 */
export type ProfileFieldName =
	| "kind"
	| "layer"
	| "pins"
	| "supersedes"
	| "bounds"
	| "repository"
	| "gate"
	| "justifies"
	| "occurred"
	| "guard"
	| "audience"
	| "url"
	| "links_to"
	| "surface"
	| "renders"
	| "entry"
	| "crosses"
	| "runbooks";

/**
 * Every built-in profile field name, in declaration order.
 * @public
 */
export const PROFILE_FIELD_NAMES: ReadonlyArray<ProfileFieldName> = [
	"kind",
	"layer",
	"pins",
	"supersedes",
	"bounds",
	"repository",
	"gate",
	"justifies",
	"occurred",
	"guard",
	"audience",
	"url",
	"links_to",
	"surface",
	"renders",
	"entry",
	"crosses",
	"runbooks",
];

/**
 * The literal frontmatter key of one profile field: `x-okfit-` plus the field name, `_` written as `-`
 * (`"links_to"` gives `"x-okfit-links-to"`). {@link ProfileKeys} and the function that builds each value are
 * both typed by it. The type handles one `_` per name, which is all the built-in fields use; the table test pins every field against the runtime spelling.
 * @public
 */
export type ProfileKey<N extends ProfileFieldName> = N extends `${infer Head}_${infer Tail}`
	? `${typeof OKFIT_KEY_PREFIX}${Head}-${Tail}`
	: `${typeof OKFIT_KEY_PREFIX}${N}`;

/** The frontmatter spelling of one profile field, kebab case under the `x-okfit-` namespace. */
const profileKey = <N extends ProfileFieldName>(name: N): ProfileKey<N> =>
	`${OKFIT_KEY_PREFIX}${name.replaceAll("_", "-")}` as ProfileKey<N>;

/**
 * The frontmatter key under which each built-in profile field is written: `x-okfit-` plus the field name,
 * with `_` written as `-` (so `links_to` is `x-okfit-links-to`). Every reader and writer of a profile field
 * goes through this table, never a literal. Each value's type is the key's literal spelling, so a computed property such as `[ProfileKeys.kind]` stays legal in an
 * interface or a `Schema.Struct`.
 * @public
 */
export const ProfileKeys: { readonly [N in ProfileFieldName]: ProfileKey<N> } = Object.fromEntries(
	PROFILE_FIELD_NAMES.map((name) => [name, profileKey(name)]),
) as {
	readonly [N in ProfileFieldName]: ProfileKey<N>;
};
