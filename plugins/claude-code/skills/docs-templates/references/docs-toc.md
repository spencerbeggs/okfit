# docs/ folder and its TOC

Load when: scaffolding `docs/`, adding a page, or rebuilding a table of contents.

## Starter set

- `docs/README.md`: TOC plus an install recap.
- `docs/01-getting-started.md`: install, import, a minimal worked example.
- `docs/02-api-reference.md`: every export with signatures and short examples.
- `docs/03-troubleshooting.md`: common stumbling blocks with concrete fixes.

Each starter page has an H1, a short summary and clearly marked TODO sections. Never overwrite an existing `docs/` without asking. Getting-started is always first; api-reference and troubleshooting are always last, in that order.

## Adding a page

1. List existing `NN-*.md` files, excluding `README.md`.
2. The new page takes the number of `02-api-reference.md`, and `03-troubleshooting.md` shift up by one (`git mv` when tracked). With a custom layout, insert before whichever page is last.
3. Draft it with an H1, a one-paragraph summary and TODO sections.
4. Rebuild the TOC. Do not edit next-page links or "What's next" lists in other pages; tell the user they may need updating.

## Building the TOC

Glob `docs/*.md` minus `README.md`, sorted by filename. Per file:

- Label: the H1, with leading emoji, markdown formatting and trailing punctuation stripped. No H1: the filename minus prefix and extension, hyphens to spaces, first letter capitalized.
- Description: the first non-heading paragraph cut to one sentence. If the existing TOC line carries a customized description and the file's first paragraph is unchanged, keep the customized one; if the paragraph changed, regenerate. When unsure, keep the existing text. No paragraph: omit the dash and description.

```markdown
- [Getting started](./01-getting-started.md) — Install the package and import it.
```

Emit only the list; the caller owns the heading. In a package README it sits under `## Documentation`, before `## License`, one bullet per page; omit the section when there are no topical pages.

## docs/README.md skeleton

```markdown
# <package-name> documentation

<one-paragraph recap from the package README tagline>

## Install

<the install block, optionally trimmed>

## Guides

<bulleted TOC>
```
