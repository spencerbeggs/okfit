---
name: okf-upgrade
description: "Upgrade an OKF bundle to v0.3 with okfit: run the report, apply the safe fixes, and work through what is left. Use when a bundle declares an older okf_version or none, or `okfit validate --target 0.3` reports findings. Trigger phrases -- \"upgrade the bundle to OKF 0.3\", \"move okf to v0.3\", \"okf_version 0.3\", \"what changed in OKF 0.3\"."
allowed-tools:
  - read
  - grep
  - edit
  - execute
---

# okf-upgrade

Moves a bundle declared at 0.2 or earlier (or at no version) up to OKF v0.3. okfit reports everything that reads differently, fixes the two things that are safe to fix, and lists the rest for you or the human. Never run `okfit verify`, and never write `verified`, `x-okfit-integrity`, `generated.at` or an existing concept's `status`: those are the human's (step 7).

## Changes from v0.2

Two breaking changes (spec §13.1); `okf-spec` has the detail.

| Change | What breaks |
| --- | --- |
| A path field or link without a leading `/` resolves from its own file's directory (§6, §6.2) | A bare value written from the bundle root no longer resolves once the bundle declares 0.3 |
| Only verifications at or after `generated.at` give the trust tier (§5.3) | Some human-reviewed concepts drop a tier |

Also new, and not findings: `superseded_by`, root `title`/`description`/`license`, the `team:` scheme, date-only timestamps, the computation locator (§10.3), non-concept `.md` files (§3.2).

## 1. Preflight

1. `okfit validate --help` lists `--target`. If it does not, the installed CLI is too old for this skill: stop and tell the human to upgrade `@okfit/cli`.
2. `git status` is clean for the bundle directory, so every fix is one reviewable diff.

## 2. Read the report

```bash
okfit validate --target 0.3 --format json
```

`--target` accepts only `0.3`. Migration findings are diagnostics with `source: "migrate"`, counted in `summary.migration_findings`, and they never change the exit code. Codes:

| Code | Meaning | Fix |
| --- | --- | --- |
| `okf-version-undeclared` | the root `index.md` declares no `okf_version` | `okf-version`, only when a root `index.md` exists (an unclosed one counts; `--fix` then refuses it) |
| `okf-version-older` | it declares an older, parsable version | `okf-version` |
| `okf-version-unparsable` | the declared value is not a quoted `<major>.<minor>` | none |
| `root-relative-path` | a link or path field, in any Markdown file in the bundle (concepts, indexes, logs, other files), resolves only from the bundle root | `root-relative-path` |
| `computation-locator` | the `Computation` section reads differently under 0.3 | none |

A diagnostic with a `fix` key names the fix `--fix` would make. `--fix` may still refuse it: the run then prints `refused: <file>: <reason>`, which says what to do first (a root `index.md` whose frontmatter does not parse, or is never closed, is one: it is fixed by hand). A diagnostic without a `fix` key can only be handled by hand. A value that misses under both rules is an ordinary `broken-links`, not a finding.

## 3. Stop on a lost computation

`computation-locator` is reported only while the bundle is undeclared or declares 0.2 or earlier. The version fix in step 4 declares 0.3, and from then on the report no longer shows it, so a computation could change meaning with nobody having looked. `--fix` itself refuses the version while any `warning` `computation-locator` stands, and the core lint `computation-missing` reports an Attested Computation that has lost its computation afterwards. Read these findings before any `--fix`.

Under 0.3 the computation is the first fenced block in the `Computation` section at any heading level (§10.3); okfit's 0.2 reading took the body of a depth-one section. A section that is exactly one fence under a depth-one heading reads the same under both and is not reported, and neither is an empty `Computation` section (no text under the heading): it holds no computation under either reading, so it is not a finding and does not hold the version back (the lint `computation-missing` still reports it). You never edit a computation (`okf-authoring` rule 12): you only report.

- A `warning` finding means the computation would be lost under 0.3 (the section has no fenced block). While any is listed, `--fix` refuses to declare the version (a `refused:` line names the concepts); report those concepts to the human, and continue only when the human has changed them. The human may instead keep a prose-only section on purpose by setting `okf_version: "0.3"` in `index.md` by hand (the refusal says so); that edit is the human's, never yours, and you only report the choice.
- An `info` finding does not block. Keep a list of them for the final report so the human can check that the 0.3 reading is what they meant.

## 4. Apply the safe fixes

First, if the bundle was written by an older okfit, rename its keys, because `--fix` refuses a concept that still uses the old key names.

`okfit validate` prints a `hint:` line on stderr when it finds such a bundle. A bundle written by an older okfit keeps its old key names (`integrity`, and the `software-project` fields such as `kind`) until a plain `okfit sync` renames them in place and reports the ids as `migrated`. Until then okfit does not see the old block, so earlier verifications report as no longer current (`verified-drift`) and a `software-project` bundle reports `required-key-missing`. `okfit sync --staged` only migrates the concepts being committed, so run a plain `okfit sync` once. On `--staged`, a rename that is the only write to a concept restages the whole file, so the first commit that touches an unmigrated concept also commits any unstaged edits to it; run a plain `okfit sync` and commit the key move on its own, before other work. Afterwards `verified-drift` may appear on concepts that were verified, and only a human re-verifies them. A project whose own config names a built-in field by its bare name (a `[types.<T>.fields.<k>]` table, or `<k>` in that type's `required` list) keeps `<k>` unrenamed for that type: the human updates that config by hand, then `okfit sync` renames the key.

If sync skips a concept as `legacy-key-conflict` (it has both the old and the new spelling of a key), show it to the human and do not delete either spelling on your own. If it skips one as `legacy-key-unsupported`, report it: that key has to be renamed by hand. Either way you never run `okfit verify` and never write `verified`.

Then the fixes:

```bash
okfit validate --target 0.3 --fix --dry-run   # says what would change, writes nothing
okfit validate --target 0.3 --fix
```

Fix the whole bundle. After the count line (`Would fix`/`Fixed <n> finding(s) in <m> file(s)`), `--fix` prints one indented `<file>: <fix kinds>` line per file it changes (`root-relative-path (2)` when a kind repeats), then any `refused:` lines. `--fix` roots each bare reference with `/` and declares `okf_version: "0.3"`. It refuses a concept that still uses okfit's old key names (`refused: <file>: ...`); run `okfit sync` first, then fix again. The version fix is refused while any root-relative path anywhere in the bundle remains unfixed, so narrowing with `--only` or a file target can leave a refusal (`refused: <file>: <reason>`). It is also refused while any `warning` `computation-locator` stands, wherever it is (step 3), while a Markdown file has unclosed or unparseable frontmatter, so its links could not be scanned, and while the root `index.md` frontmatter never closes or does not parse; each cause prints its own `refused:` line, and `okfit validate --target 0.3` counts such findings in its summary as `<r> refused by --fix` instead of `fixable`; a refused fix does not change the exit code. With no root `index.md` there is nothing to fix for the version. Run `okfit sync`, which writes the root index (with an `okf_version` only when the config sets one), then re-run step 2: if `okf-version-undeclared` is still listed, it now carries a fix, and `--fix` declares the version.

If the project config sets `okf_version`, the version fix leaves it as it was, and the next `okfit validate` reports it as `config-okf-version-stale`: remove `okf_version` from the config or set it to the target, by hand or by asking the human. okfit never edits the config.

Read the output: `Fixed <n> finding(s) in <m> file(s)`, any `refused:` lines, and `Integrity drifted (re-verify with okfit verify): <ids>`. JSON carries `fixes: { applied, refused, drifts, dry_run }`. The fix never writes `verified`, `x-okfit-integrity.verified` or `generated.at`. When a concept's recorded `x-okfit-integrity.generated.body` matched its body before the edit, the fix re-records that digest. Otherwise the concept's body digest no longer matches, and the next `okfit sync` stamps a new `generated.at`, so an earlier human verification stops counting. Review the git diff.

## 5. Work through what is left

- **`okf-version-unparsable`**: ask the human what version they meant; do not guess.
- **`legacy-timestamp`**: okfit reads a v0.1 `timestamp` as `generated.at`; the file is unchanged. Ask who wrote the content before writing `generated.by`; never invent an actor.
- **`frontmatter-missing`, `type-missing`, `non-concept-unlisted`**: give the file a `type`, move it out of the bundle, or ask the human to list it under `[bundle] non_concepts` (`okf-config`).
- **A deprecated concept that has a replacement**: add `superseded_by` with the replacement's path (§5.4). Do not change any `status` yourself.

## 6. Report trust effects, then sync

Report the `drifts` list from the `--fix` output to the human now. Then run `okfit sync` and `okfit validate` to confirm the bundle is no worse. `okfit sync` skips a concept whose edit is uncommitted (it never substitutes the current time), so these runs will not yet show every effect; do not tell the human that nothing was affected.

Tell the human that the edited concepts are stamped only once the change is committed (the `okfit sync` they run after committing, or a commit hook that runs it). After that, `okfit validate` may show `verified-before-change` on edited concepts that had no recorded body digest, and only the human re-verifies those. Do not commit unless the human asked you to, and never try to repair a verification.

## 7. Stop and ask the human

Stop and report, never work around it, when a step needs: a `verified`, `x-okfit-integrity`, `generated.at` or `status` change; `drifts` or a `verified-before-change` lint (only the human re-verifies, with `okfit verify`, which you never run); an unparsable version; or a computation whose meaning would change.

## 8. Done

`okfit validate --target 0.3` reports no `migrate` finding (the `computation-locator` ones went away only because the bundle now declares 0.3; step 3's `warning` ones held the version back until the human changed them, and the lint `computation-missing` reports any computation lost afterwards), and plain `okfit validate` is no worse than before you started. Report what the fixes changed, what you did by hand, the `info` computation findings from step 3 for the human to check, and what waits for the human.
