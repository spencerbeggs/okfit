---
name: okf-upgrade
description: "Upgrade an OKF bundle to v0.3 with okfit: run the report, apply the safe fixes, and work through what is left. Use when a bundle declares an older okf_version or none, or `okfit validate --target 0.3` reports findings. Trigger phrases -- \"upgrade the bundle to OKF 0.3\", \"move okf to v0.3\", \"okf_version 0.3\", \"what changed in OKF 0.3\"."
allowed-tools: Read, Grep, Edit, Bash(okfit validate:*), Bash(okfit sync:*), Bash(pnpm exec okfit validate:*), Bash(pnpm exec okfit sync:*), Bash(npx okfit validate:*), Bash(npx okfit sync:*), Bash(node_modules/.bin/okfit validate:*), Bash(node_modules/.bin/okfit sync:*), Bash(git status:*)
---

# okf-upgrade

Moves a bundle declared at 0.2 or earlier (or at no version) up to OKF v0.3. okfit reports everything that
reads differently, fixes the two things that are safe to fix, and lists the
rest for you or the human. Never run `okfit verify`, never write `verified`,
`integrity`, `generated.at` or an existing concept's `status`: those are the
human's (step 6).

## 1. What changed

Two breaking changes (spec §13.1); `okf-spec` has the detail.

| Change | What breaks |
| --- | --- |
| A path field or link without a leading `/` resolves from its own file's directory (§6, §6.2) | A bare value written from the bundle root no longer resolves once the bundle declares 0.3 |
| Only verifications at or after `generated.at` give the trust tier (§5.3) | Some human-reviewed concepts drop a tier |

Also new, and not findings: `superseded_by`, root `title`/`description`/
`license`, the `team:` scheme, date-only timestamps, the computation locator
(§10.3), non-concept `.md` files (§3.2).

## 2. Preflight

1. `okfit validate --help` lists `--target`. If it does not, the installed CLI is
   too old for this skill: stop and tell the human to upgrade `@okfit/cli`.
2. `git status` is clean for the bundle directory, so every fix is one
   reviewable diff.

## 3. Read the report

```bash
okfit validate --target 0.3 --format json
```

`--target` accepts only `0.3`. Migration findings are diagnostics with
`source: "migrate"`, counted in `summary.migration_findings`, and they never
change the exit code. Codes:

| Code | Meaning | Fix |
| --- | --- | --- |
| `okf-version-undeclared` | the root `index.md` declares no `okf_version` | `okf-version` |
| `okf-version-older` | it declares an older, parsable version | `okf-version` |
| `okf-version-unparsable` | the declared value is not a quoted `<major>.<minor>` | none |
| `root-relative-path` | a link or path field resolves only from the bundle root | `root-relative-path` |
| `computation-locator` | the `Computation` section reads differently under 0.3 | none |

A diagnostic with a `fix` key can be fixed by `--fix`; one without can only be
handled by hand. `computation-locator` appears only while the bundle is
undeclared or declares 0.2 or earlier. A value that misses under both rules is
an ordinary `broken-links`, not a finding.

## 4. Apply the safe fixes

```bash
okfit validate --target 0.3 --fix --dry-run   # says what would change, writes nothing
okfit validate --target 0.3 --fix
```

Fix the whole bundle. `--fix` roots each bare reference with `/` and declares
`okf_version: "0.3"`; the version fix is refused while any root-relative path
anywhere in the bundle remains unfixed, so narrowing with `--only` or a file
target can leave a refusal (`refused: <file>: <reason>`). Read the output:
`Fixed <n> finding(s) in <m> file(s)`, then any `refused:` lines. JSON carries
`fixes: { applied, refused, drifts, dry_run }`. The fix never writes
`verified`, `integrity.verified` or `generated.at`; on a concept whose body
digest matched, it re-records that digest so `okfit sync` keeps `generated.at`.
Review the git diff.

## 5. Work through what is left

- **`computation-locator`**: under 0.3 the computation is the first fenced
  block in the `Computation` section at any heading level (§10.3). Put the
  computation in exactly one fence under a `Computation` heading. If doing so
  would change what it means, or it is not clear which block is the
  computation, ask (step 6).
- **`okf-version-unparsable`**: ask the human what version they meant; do not
  guess.
- **`legacy-timestamp`**: a v0.1 `timestamp` was folded into `generated.at`.
  Ask who wrote the content before writing `generated.by`; never invent an
  actor.
- **`frontmatter-missing`, `type-missing`, `non-concept-unlisted`**: give the
  file a `type`, move it out of the bundle, or ask the human to list it under
  `[bundle] non_concepts` (`okf-config`).
- **A deprecated concept that has a replacement**: add `superseded_by` with the
  replacement's path (§5.4). Do not change any `status` yourself.

## 6. Stop and ask the human

Stop and report, never work around it, when a step needs: a `verified`,
`integrity`, `generated.at` or `status` change; `drifts` in the fix output or a
`verified-before-change` lint (only the human re-verifies, with `okfit verify`,
which you never run); an unparsable version; or a computation whose meaning
would change.

## 7. Done

`okfit validate --target 0.3` reports no `migrate` finding, and plain
`okfit validate` is no worse than before you started. Then run `okfit sync`.
Report what the fixes changed, what you did by hand, and what waits for the
human.
