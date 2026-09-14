# software-project fixture

A repository-shaped fixture: the bundle lives at `okf/`, and the sibling
files exist only so the bundle's `resource:` paths (`../../packages/core`,
`../../.github/workflows/release.yml`, ...) resolve on disk wherever the
whole directory is copied. Load the bundle from `okf/`; copy the directory
itself into a sandbox to get a repo the CLI can validate clean.
