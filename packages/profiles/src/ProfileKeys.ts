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

/** The frontmatter spelling of one profile field (identity today; the only line a rename changes). */
const profileKey = <N extends ProfileFieldName>(name: N): N => name;

/**
 * The frontmatter key under which each built-in profile field is written. Every
 * reader and writer of a profile field goes through this table, never a literal.
 * The value type is the key's literal spelling, so a computed property such as
 * `[ProfileKeys.kind]` stays legal in an interface or a `Schema.Struct`.
 * @public
 */
export const ProfileKeys: { readonly [N in ProfileFieldName]: N } = Object.fromEntries(
	PROFILE_FIELD_NAMES.map((name) => [name, profileKey(name)]),
) as { readonly [N in ProfileFieldName]: N };
