# Monorepo router README

Load when: writing or restructuring the README at a monorepo root.

The root README is a developer-facing hub, not an npm page. It carries no badge block and routes readers onward rather than documenting packages itself. The Surface body overrides anything below.

```markdown
# <repo-name>

<one paragraph: the repo and its place in the wider ecosystem>

## Packages

| Package | Purpose |
| --- | --- |
| [name](packages/name) | one line |

## Install

<the common install incantation, or "see each package's README">

## Ecosystem     <- optional; for repos spanning related but separate packages

<categorized list of related packages or repos>

## Requirements

- <runtime> <engineRange>
- <package manager, if relevant>

## License

[<license>](LICENSE)
```

Link each package row to its directory. Detail belongs in the package README or on the site, as the Surface's `links_to` says.
