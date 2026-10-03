import type { SurfaceTemplate } from "../Profile.js";

const FENCE = "```";

/**
 * The durable prose rules every surface body repeats, ported from the
 * design-docs `user-docs` agent. Kept as one list so the rules cannot drift
 * between surfaces.
 */
const RULES = [
	"## Prose rules",
	"",
	"- Use sentence case for every heading: `## API reference`, not `## API Reference`. Acronyms and proper nouns keep their case.",
	"- Put every paragraph and list item on one source line; never hard-wrap prose.",
	"- Give every code fence a language identifier.",
	"- Show the expected output of every example that logs a value or runs a command, as comments on the lines after it: `// ...` for JavaScript and TypeScript, `# ...` for shell.",
	"- Never invent output, paths, identifiers or messages; when the real output cannot be verified from the source or by running the command, write a generic placeholder such as `# example output (varies by environment)`.",
	"- Lead install commands with npm or npx and list at most one alternative (pnpm, yarn or bun) below it, unless the page is about package-manager-specific behavior.",
	"- Never write a specific version number in prose; the npm badge and `package.json` are the source of truth. Do not state versions except in a migration guide between major versions.",
	"- Match the language of the surrounding source and docs, and avoid filler, hype and AI-sounding phrasing.",
	"- Never invent a tagline, feature or example: take them from `package.json`, the exported symbols and existing docs, and ask when none exist.",
].join("\n");

const SINGLE_PACKAGE_SKELETON = [
	`${FENCE}markdown`,
	"# <package-name>",
	"",
	"<badges, built with the docs badge tooling rather than typed by hand>",
	"",
	"<one-paragraph tagline: what this is, what it does, why someone wants it>",
	"",
	"## Install",
	"",
	"<npm command and at most one alternative line>",
	"",
	"Requires <runtime> <engine range>.",
	"",
	"## Quick start",
	"",
	"<minimal worked example in one code block, with expected output as comments>",
	"",
	"## Features",
	"",
	"<bulleted list, one sentence each>",
	"",
	"## Documentation",
	"",
	"<one bullet per topical page in docs/; omit the section when docs/ has none>",
	"",
	"## License",
	"",
	"[<license>](LICENSE)",
	FENCE,
].join("\n");

const MONOREPO_ROOT_SKELETON = [
	`${FENCE}markdown`,
	"# <repo-name>",
	"",
	"<one paragraph: what the repository is and where it sits in its ecosystem>",
	"",
	"## Packages",
	"",
	"<table with Package and Purpose columns, each package linked to its directory>",
	"",
	"## Install",
	"",
	"<the common install command, or a pointer to each package README>",
	"",
	"## Requirements",
	"",
	"- <runtime> <engine range>",
	"",
	"## License",
	"",
	"[<license>](LICENSE)",
	FENCE,
].join("\n");

const DOCS_TOC_SKELETON = [
	`${FENCE}markdown`,
	"# <package-name> documentation",
	"",
	"<one-paragraph recap of the package, taken from the README tagline>",
	"",
	"## Install",
	"",
	"<the same npm install block as the README, optionally trimmed>",
	"",
	"## Pages",
	"",
	"<one bullet per page: a link and a one-line description>",
	FENCE,
].join("\n");

const ONE_PAGE_PACKAGE_SKELETON = [
	`${FENCE}markdown`,
	"# <package-name>",
	"",
	"<badges, built with the docs badge tooling rather than typed by hand>",
	"",
	"<one-paragraph tagline>",
	"",
	"## Install",
	"",
	"<npm command and at most one alternative line>",
	"",
	"## Quick start",
	"",
	"<one minimal example with expected output as comments>",
	"",
	"**Full documentation: <link to the site>**",
	FENCE,
].join("\n");

const ONE_PAGE_ROOT_SKELETON = [
	`${FENCE}markdown`,
	"# <repo-name>",
	"",
	"<one-paragraph summary of the repository>",
	"",
	"**Full documentation: <link to the site>**",
	"",
	"## Packages",
	"",
	"<table with Package and Purpose columns, each package linked to its directory>",
	FENCE,
].join("\n");

const CONTRIBUTOR_GUIDE_SKELETON = [
	`${FENCE}markdown`,
	"# <task, as a verb phrase: Make a pull request>",
	"",
	"<one sentence: what this guide gets the reader to>",
	"",
	"## Who this is for",
	"",
	"<the reader, e.g. a first-time contributor with a fork, and what they should already know>",
	"",
	"## Before you start",
	"",
	"<prerequisites as a list: tools and versions, access, a clean checkout, an issue to work from>",
	"",
	"## Steps",
	"",
	"1. <imperative step, with the exact command in a code fence>",
	"2. <next step>",
	"",
	"## What success looks like",
	"",
	"<the observable end state: the passing check, the open PR, the command output>",
	"",
	"## Rules this guide follows",
	"",
	"<one bullet per rule the steps restate, each linking to the page that owns it>",
	FENCE,
].join("\n");

const body = (...parts: ReadonlyArray<string>): string => parts.join("\n\n");

/** The package README: published to npm, the package's onboarding page. */
export const README_PACKAGE: SurfaceTemplate = {
	file: "surfaces/readme-package.md",
	frontmatter: {
		type: "Surface",
		status: "draft",
		title: "Package README",
		description: "The README published to npm for a package, written for people who install it.",
		kind: "readme",
		audience: "users",
		resource: "../../README.md",
		links_to: "docs-repo.md",
	},
	body: body(
		"# Package README",
		"## Who reads this",
		"People deciding whether to install the package and getting their first call working. They arrive from npm or the repository page with no context.",
		"## Required structure",
		"Follow this outline and fill it from the codebase: the tagline from `package.json` `description`, the features from the exported symbols, and the quick start from the simplest real call. Omit any section you cannot ground.",
		SINGLE_PACKAGE_SKELETON,
		"If `package.json` has no `engines` field, omit the runtime badge and the requirements line rather than guessing a range.",
		"## Other surfaces",
		"Contributor setup, internals and architecture belong in contributor docs; deep topical guides belong in `docs/`, listed under the Documentation section.",
		RULES,
	),
};

/** The one-page package README that routes readers to the documentation site. */
export const README_PACKAGE_ONE_PAGE: SurfaceTemplate = {
	file: "surfaces/readme-package.md",
	frontmatter: {
		type: "Surface",
		status: "draft",
		title: "Package README",
		description: "A one-page README published to npm that routes readers to the documentation site.",
		kind: "readme",
		audience: "users",
		resource: "../../README.md",
		links_to: "site.md",
	},
	body: body(
		"# Package README",
		"## Who reads this",
		"People deciding whether to install the package. The documentation site carries the full guides, so this page stays short.",
		"## Required structure",
		"Write exactly this and nothing more: the title, the badges, a tagline, the install command, one quick start, and a prominent link to the documentation site.",
		ONE_PAGE_PACKAGE_SKELETON,
		"Leave out Features, Documentation and every other section; the site carries them.",
		"## Other surfaces",
		"Anything longer than a quick start belongs on the documentation site this surface links to.",
		RULES,
	),
};

/** The monorepo root README: a developer-facing hub, no badges. */
export const README_ROOT: SurfaceTemplate = {
	file: "surfaces/readme-root.md",
	frontmatter: {
		type: "Surface",
		status: "draft",
		title: "Repository README",
		description: "The monorepo root README: a hub that explains the packages and how they relate.",
		kind: "readme",
		audience: "contributors",
		resource: "../../README.md",
	},
	body: body(
		"# Repository README",
		"## Who reads this",
		"Contributors and visitors who landed on the repository and need to find the package they want. This page routes; it does not document any one package.",
		"## Required structure",
		"Follow this outline. Carry no badges on this page; they belong on each package README.",
		MONOREPO_ROOT_SKELETON,
		"Add an Ecosystem section only when the repository spans related but separate packages.",
		"## Other surfaces",
		"Per-package install and usage belong in each package README; contributor workflow belongs in contributor docs.",
		RULES,
	),
};

/** The monorepo root README that routes readers to the documentation site. */
export const README_ROOT_ONE_PAGE: SurfaceTemplate = {
	file: "surfaces/readme-root.md",
	frontmatter: {
		type: "Surface",
		status: "draft",
		title: "Repository README",
		description: "A one-page monorepo root README that routes readers to the documentation site.",
		kind: "readme",
		audience: "contributors",
		resource: "../../README.md",
		links_to: "site.md",
	},
	body: body(
		"# Repository README",
		"## Who reads this",
		"People who landed on the repository and need to find the package or guide they want.",
		"## Required structure",
		"Write exactly this and nothing more: the title, a one-paragraph summary, a prominent link to the documentation site, and the packages table. Carry no badges.",
		ONE_PAGE_ROOT_SKELETON,
		"## Other surfaces",
		"Guides and reference belong on the documentation site this surface links to.",
		RULES,
	),
};

/** The README inside each monorepo package. */
export const README_PACKAGES: SurfaceTemplate = {
	file: "surfaces/readme-packages.md",
	frontmatter: {
		type: "Surface",
		status: "draft",
		title: "Sub-package READMEs",
		description: "The README inside each monorepo package, published to npm with the package.",
		kind: "readme",
		audience: "users",
		resource: "../../packages/*/README.md",
	},
	body: body(
		"# Sub-package READMEs",
		"## Who reads this",
		"People installing one package from npm. They never see the monorepo root README, so each page stands alone.",
		"## Required structure",
		"Use the single-package outline, with the badges built from that package's own `package.json`.",
		SINGLE_PACKAGE_SKELETON,
		"## Other surfaces",
		"How the packages relate belongs on the repository README; contributor workflow belongs in contributor docs.",
		RULES,
	),
};

/** The one-page sub-package README that routes readers to the documentation site. */
export const README_PACKAGES_ONE_PAGE: SurfaceTemplate = {
	file: "surfaces/readme-packages.md",
	frontmatter: {
		type: "Surface",
		status: "draft",
		title: "Sub-package READMEs",
		description: "A one-page README inside each monorepo package that routes readers to the documentation site.",
		kind: "readme",
		audience: "users",
		resource: "../../packages/*/README.md",
		links_to: "site.md",
	},
	body: body(
		"# Sub-package READMEs",
		"## Who reads this",
		"People installing one package from npm. The documentation site carries the full guides, so each page stays short.",
		"## Required structure",
		"Write exactly this and nothing more: the title, the badges, a tagline, the install command, one quick start, and a prominent link to the package's page on the documentation site.",
		ONE_PAGE_PACKAGE_SKELETON,
		"## Other surfaces",
		"Anything longer than a quick start belongs on the documentation site this surface links to.",
		RULES,
	),
};

const docsRepo = (options: {
	readonly file: string;
	readonly title: string;
	readonly description: string;
	readonly audience: "users" | "contributors";
	readonly resource: string;
	readonly linksTo?: string;
	readonly reader: string;
	readonly title1: string;
}): SurfaceTemplate => ({
	file: options.file,
	frontmatter: {
		type: "Surface",
		status: "draft",
		title: options.title,
		description: options.description,
		kind: "repo",
		audience: options.audience,
		resource: options.resource,
		...(options.linksTo === undefined ? {} : { links_to: options.linksTo }),
	},
	body: body(
		`# ${options.title1}`,
		"## Who reads this",
		options.reader,
		"## Required structure",
		"Name every page `{NN}-{slug}.md`: a two-digit zero-padded number and a kebab-case slug, such as `01-getting-started.md`. Start from `01-getting-started.md`, `02-api-reference.md` and `03-troubleshooting.md`; later topical pages slot between the first and the last two. Keep `README.md` as the table of contents:",
		DOCS_TOC_SKELETON,
		"List the pages with the docs table-of-contents tooling rather than by hand, and rename any page that breaks the filename format with `git mv`.",
		"## Other surfaces",
		"The one-page pitch and install command belong in the README; contributor workflow belongs in contributor docs.",
		RULES,
	),
});

const USERS_DOCS_READER =
	"People who finished the README and want a guide, the API reference or troubleshooting help. They read the files on the forge, so every page must read well as plain markdown.";

/** A `docs/` folder of topical pages for a single package, read on the forge. */
export const DOCS_PACKAGE: SurfaceTemplate = docsRepo({
	file: "surfaces/docs-repo.md",
	title: "Repository docs folder",
	title1: "Repository docs folder",
	description: "Topical markdown pages in docs/, read in place on the forge and linked from the README.",
	audience: "users",
	resource: "../../docs",
	reader: USERS_DOCS_READER,
});

/** The root `docs/` folder of a monorepo: shared contributor pages read on the forge. */
export const DOCS_REPO: SurfaceTemplate = docsRepo({
	file: "surfaces/docs-repo.md",
	title: "Repository docs folder",
	title1: "Repository docs folder",
	description:
		"Shared contributor pages in the root docs/, read in place on the forge and linked from the root README.",
	audience: "contributors",
	resource: "../../docs",
	linksTo: "readme-root.md",
	reader:
		"Contributors who need the shared workflow, architecture notes or release process. They read the files on the forge, so every page must read well as plain markdown.",
});

/** The `docs/` folder inside each monorepo package. */
export const DOCS_PACKAGES: SurfaceTemplate = docsRepo({
	file: "surfaces/docs-packages.md",
	title: "Sub-package docs folders",
	title1: "Sub-package docs folders",
	description: "Topical markdown pages in each package's docs/, read in place on the forge and linked from its README.",
	audience: "users",
	resource: "../../packages/*/docs",
	linksTo: "readme-packages.md",
	reader: USERS_DOCS_READER,
});

/** Step-by-step contributor guides in the root `docs/`, read on the forge. */
export const CONTRIBUTOR_GUIDES: SurfaceTemplate = {
	file: "surfaces/contributor-guides.md",
	frontmatter: {
		type: "Surface",
		status: "draft",
		title: "Contributor guides",
		description:
			"Task-shaped contributor guides in the root docs/, such as making a pull request, read in place on the forge.",
		kind: "repo",
		audience: "contributors",
		resource: "../../docs",
		links_to: "readme-root.md",
	},
	body: body(
		"# Contributor guides",
		"## Who reads this",
		"Contributors about to do one concrete thing in the repository, such as open a pull request or cut a release. They follow the page top to bottom with a terminal open, so each guide is a procedure, not an essay.",
		"## Required structure",
		"Write one guide per task, named `{NN}-{slug}.md` like every other page in `docs/`, for example `01-making-a-pull-request.md`. Use this outline and omit no section:",
		CONTRIBUTOR_GUIDE_SKELETON,
		"State each rule the steps rely on once, in its own bullet under the last section, and link to the page that owns it rather than restating the rationale. Take commands from the repository's scripts and verify them before writing them down.",
		"## Other surfaces",
		"Reference material and architecture notes belong in the shared docs folder surface; the root README only routes to these guides.",
		RULES,
	),
};

/** The documentation website. */
export const SITE: SurfaceTemplate = {
	file: "surfaces/site.md",
	frontmatter: {
		type: "Surface",
		status: "draft",
		title: "Documentation site",
		description: "The published documentation website: guides, reference and tutorials for people using the project.",
		kind: "site",
		audience: "users",
		resource: "../../website",
		url: "https://example.invalid",
	},
	body: body(
		"# Documentation site",
		"## Who reads this",
		"People using the project who want guides, reference and worked tutorials. This is the long-form home; the READMEs only point here.",
		"## Required structure",
		"Organize pages by what the reader is trying to do: a getting-started path first, task guides next, reference last. Give every page one clear job, a sentence-case title and a short summary before the first heading. Link between pages instead of repeating their content.",
		"Replace the placeholder `url` in this concept's frontmatter with the real published address before relying on it.",
		"## Other surfaces",
		"The README carries only the pitch, the install command and one quick start, and links here for everything else; contributor workflow belongs in contributor docs.",
		RULES,
	),
};
