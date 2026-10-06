# Package README

Load when: writing or restructuring a README for a single package or a monorepo sub-package.

The Surface body overrides anything below.

```markdown
# <package-name>

<badge block from docs-badges>

<one-paragraph tagline: what it is, what it does, why someone wants it>

## Why <package-name>     <- optional; when the value proposition needs framing

<2-4 sentences>

## Install

<npm line and one alternative>

Requires <runtime> <engineRange>.     <- only when engines is declared

## Quick start

<minimal worked example in one code block>

## Usage / Features

<one section per command or a bulleted capability list, one sentence each>

## Documentation     <- only when docs/ has topical pages

<bulleted TOC, see docs-toc.md>

## License

[<license>](LICENSE)
```

For a CLI package the order is: title, one-line description, badges, `## Usage`, one section per command, config discovery, exit codes, `--format json`, message conventions, `## License`.

A single-package repo whose workspace is only self-referential is still this shape.
