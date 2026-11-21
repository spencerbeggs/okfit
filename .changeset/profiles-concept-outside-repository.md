---
"@okfit/profiles": minor
---

## Features

- `Derivation.generatedAt` now fails with the new `ConceptOutsideRepositoryError`, naming the file, when a concept resolves outside the repository through an escaping symlink or when containment cannot be proved. It replaces the opaque `GitCommandError` this case produced before, and `GeneratedAtError` and `Provenance.lint` include it.
