---
"@okfit/profiles": minor
---

## Features

- Add `Surface` and `Publication` concept types to the `software-project` profile, stored under `surfaces/` and `publications/`. A Surface describes where one kind of published docs lives and who reads it; a Publication records which concepts a published page was rendered from.
- Add a `Publications` export with `resolveRef`, `rendersOf`, and `lint`. `lint` reports `publication-drift` when a source concept changed after the page was rendered, and `publication-orphan` when a publication references a concept that does not exist.
