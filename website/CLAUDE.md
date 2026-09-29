# docs (the okfit website)

The okfit documentation site: an RSPress 2 site using
`rspress-plugin-api-extractor`, planned for `https://okfit.dev`. A private
workspace member, never published.

## Layout

- `rspress.config.ts` -- site config.
- `content/` -- authored pages. `/docs/**` is the user-facing hierarchy;
  `/<pkg>/**` is each package's technical hierarchy beside its generated
  `/<pkg>/api`.
- `lib/models/<pkg>/` -- API models copied in by each package's prod build
  (`meta.localPaths` in the package's `savvy.build.ts`).
- `lib/scripts/` -- the `dev` and `preview` launchers.

## Rules

- Never edit or commit `lib/models/*`, `content/*/api/` or `**/.api-docs/**`;
  they are generated and gitignored. Rebuild the package and the site
  instead.
- Package pages go at `/<pkg>`, not under `/docs`.
- Relative imports use `.js` extensions; built-ins use `node:`.

## Commands

```bash
pnpm dev        # from the repo root: build:prod for the packages, then the dev server
pnpm preview    # from the repo root: build, then preview the built site
```

See [Website](../okf/modules/website.md) for the build hand-off and URL
model, and [Documentation site](../okf/roadmaps/documentation-site.md) for
what is planned.
