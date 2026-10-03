import type { DocsPreset } from "../Profile.js";
import {
	CONTRIBUTOR_GUIDES,
	DOCS_PACKAGE,
	DOCS_PACKAGES,
	DOCS_REPO,
	README_PACKAGE,
	README_PACKAGES,
	README_PACKAGES_ONE_PAGE,
	README_PACKAGE_ONE_PAGE,
	README_ROOT,
	README_ROOT_ONE_PAGE,
	SITE,
} from "./surfaces.js";

/**
 * The docs-surface presets the `software-project` profile offers, one per
 * repository shape. Three replace a repository's surfaces; `site` is
 * additive and swaps the README templates for one-page variants that link to
 * the site.
 *
 * @public
 */
export const DOCS_PRESETS: ReadonlyArray<DocsPreset> = [
	{
		name: "npm-package",
		description: "A single package published to npm: a README surface that links to a docs/ folder surface.",
		additive: false,
		surfaces: [README_PACKAGE, DOCS_PACKAGE],
	},
	{
		name: "monorepo-router",
		description: "A monorepo whose root README routes to per-package READMEs.",
		additive: false,
		surfaces: [README_ROOT, README_PACKAGES],
	},
	{
		name: "monorepo-shared-docs",
		description:
			"A monorepo with routing READMEs plus a shared root docs/ folder, contributor guides and per-package docs/ folders read on the forge.",
		additive: false,
		surfaces: [README_ROOT, README_PACKAGES, DOCS_REPO, DOCS_PACKAGES, CONTRIBUTOR_GUIDES],
	},
	{
		name: "site",
		description:
			"A documentation website plus one-page README variants that link to it; keep the variants that match the repository shape.",
		additive: true,
		surfaces: [SITE, README_ROOT_ONE_PAGE, README_PACKAGES_ONE_PAGE, README_PACKAGE_ONE_PAGE],
	},
];
