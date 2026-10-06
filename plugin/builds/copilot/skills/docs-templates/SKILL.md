---
name: docs-templates
description: Gives the section order and skeletons for a package README, a monorepo router README and a docs/ folder with its table of contents. Use when creating or restructuring a README or docs page, adding a page to docs/, or rebuilding a docs TOC ("scaffold a package README", "add a docs page", "update the docs TOC").
allowed-tools:
  - read
  - edit
  - glob
  - grep
  - mcp/get_concept
---

# docs-templates

Defaults for page structure. **The Surface body always overrides a template default.** Before using any skeleton, `get_concept` the Surface the page belongs to (`mcp-get_concept`, ids under `surfaces/`) and follow its required and forbidden sections; fall back to the defaults here only where it is silent. No Surface yet: use the defaults here, and suggest `docs-detect-shape` to set Surfaces up.

## Pick the shape

Classify the target from its `package.json` and workspace files. A repo with no real sub-package (a `package.json` outside the root that `pnpm-workspace.yaml` or `workspaces` globs match) is a **single package** and gets a package README. A **monorepo root** has at least one such sub-package and gets a router README that lists the packages and carries no badges. A package that sits under a parent's workspace globs is a **monorepo sub-package** and gets a package README built from its own `package.json`. A self-referential workspace (`workspaces: ["."]`) is still a single package. `docs-detect-shape` carries the full rules and writes Surfaces; this paragraph is enough to pick a skeleton. Read the matching reference when you write:

- `references/readme-package.md` when writing a README for a published package.
- `references/readme-router.md` when writing a monorepo root README.
- `references/docs-toc.md` when scaffolding `docs/`, adding a page to it, or rebuilding its table of contents.
- `references/contributor-guide.md` when writing a task-shaped contributor page in `docs/`, such as making a pull request.

## Rules for every page

- Fill skeletons with real content from the codebase and bundle, never boilerplate. Source order for a tagline, motivation or quick start: the existing README, then `docs/01-getting-started.md`, then the package source. Prefer carrying over a working quick start and verifying it.
- A paragraph or list item is one line of source; the renderer wraps it.
- Sentence-case headings, keeping acronyms (`CLI`, `XDG`) and proper nouns (`TypeScript`, `Node.js`).
- Every code fence names a language.
- `## License` is always last, linked as `[<license>](LICENSE)`.
- No specific version numbers in prose; the npm badge and `package.json` own them.
- Badges come from `docs-badges`, never typed by hand. A router README has none.
- Files under `docs/` use `{NN}-{slug}.md`: two-digit number, kebab-case slug. Rename non-conforming files and update links to them.
