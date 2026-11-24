---
"@okfit/cli": minor
---

## Breaking Changes

okfit's own frontmatter keys now carry the `x-okfit-` prefix: `integrity` is `x-okfit-integrity`, and the built-in `software-project` profile fields are prefixed the same way.

- `okfit sync` moves an old bundle: it renames the old keys in place and reports the concepts as migrated. A concept it cannot stamp is still renamed and listed as skipped with a note that its keys were renamed. Two new skip reasons are printed: a concept with both spellings of a key, and a key that cannot be renamed in place (flow style, an alias or a `<<` merge in the old integrity block, a duplicated key or an explicit `?` key).
- `okfit verify` and `okfit validate … --fix` refuse a concept that still carries the old `integrity` block and say to run `okfit sync` first.
- Until a plain `okfit sync` runs, okfit does not see the old block: earlier verifications report as no longer current (`verified-drift`), and a `software-project` bundle reports `required-key-missing` for the prefixed fields. Renaming a profile key changes the content digest, so a verified concept that carries one needs `okfit verify` again.
- The pre-commit hook's `sync --staged` migrates only the concepts being committed, so run a plain `okfit sync` once per bundle. On `--staged`, a rename that is the only write to a concept restages the whole file, so the first commit that touches an unmigrated concept also commits any unstaged edits to it; run a plain `okfit sync` and commit the key move on its own before other work.
- A project config that names a built-in field by its bare name, in a `[types.<T>.fields.<k>]` table or in that type's `required` list, keeps `<k>` unrenamed for that type. Update the config by hand, then run `okfit sync` to rename the key.

The derived `integrity: current|drifted|none` signal keeps its name.
