---
name: okf-spec
description: >-
  OKF v0.3 condensed reference: the conformance floor, which files are
  concepts, the frontmatter field table by family, timestamps, the trust tier,
  links and path fields, reserved files, tolerant reading, the computation
  locator, and the changes from v0.2. Use when authoring or reviewing an OKF
  concept file, deciding which frontmatter fields to set, or checking whether a
  bundle is conformant. Trigger phrases -- "what fields does OKF 0.3 support",
  "is verified required", "what changed in OKF 0.3", "actor convention",
  "frontmatter reference table", "is this concept conformant", "how do OKF
  links resolve".
---

# OKF Spec

OKF v0.3 is a directory tree of UTF-8 Markdown files: YAML frontmatter, then a
free-form body. No registry, no required tooling (§1, §3). Section marks below
are OKF v0.3 sections; "okfit" marks what okfit adds or chooses.

## Conformance floor

A bundle is conformant when every frontmatter block parses as a YAML mapping
and each reserved file (`index.md`, `log.md`) follows §8 and §9 (§11.1). A
concept with only a non-empty `type` is fully conformant (§4.1). Never invent
required fields beyond what the active profile or config declares (see
`okf-authoring` rule 1).

A `.md` file is a concept only when it is not reserved and has frontmatter with
a non-empty `type`. A `.md` file with no frontmatter or no `type` is not a
concept: consumers skip it, it does not affect conformance, and validators
SHOULD warn (§3.2). Files that are not `.md` are assets. Dot-files and
dot-directories are outside the bundle. Consumers do not follow symbolic links
out of the bundle root (§3.2). Consumers MUST NOT reject a bundle for missing
optional fields, unknown types, unknown keys, broken links or a missing
`index.md` (§11.2).

okfit adds an opinion on top: the lint `non-concept-unlisted` warns about a
typeless `.md` the config's `[bundle] non_concepts` globs do not list
(`okf-config`).

## Frontmatter reference table

| Field | Family | Required | Notes | § |
| --- | --- | --- | --- | --- |
| `type` | core | **yes**, the only always-required key | Short string; consumers MUST accept unknown types | 4.1 |
| `title` | core | optional | A consumer MAY derive one from the filename | 4.1 |
| `description` | core | optional | One sentence | 4.1 |
| `resource` | core | optional | URI of the underlying asset; absent for abstract concepts | 4.1 |
| `tags` | core | optional | List of short strings; a scalar is one tag | 4.1, 11.2 |
| `sources` | provenance | optional | List of entries | 5.1 |
| `sources[].resource` | provenance | **required in each entry** | A followable URL or path, or a scope descriptor | 5.1 |
| `sources[].id` | provenance | optional | Footnote key; SHOULD be set when the body cites the source | 5.1 |
| `sources[].title`, `.author`, `.usage_count`, `.last_modified` | provenance | optional | `author` is an actor | 5.1 |
| `usage_window` | provenance | optional | `{from, to}` for `usage_count` | 5.1 |
| `generated.by` | trust | **required in `generated`** | An actor | 5.2 |
| `generated.at` | trust | optional | Time of the last meaningful change | 5.2 |
| `verified` | trust | optional | List of `{by, at}`, both required; a bare mapping is a one-item list | 5.2 |
| `status` | lifecycle | optional | `draft`, `stable` or `deprecated`; absent means `stable`; any other value is not `stable` | 5.4 |
| `superseded_by` | lifecycle | optional | One path to the replacement; meaningful only with `status: deprecated` | 5.4 |
| `stale_after` | lifecycle | optional | Absolute instant; stale when `now >= stale_after`; an unparsable value is never fresh | 5.5 |
| `runtime` | computation | required for an Attested Computation | `bigquery`, `dbt`, `python`... | 10.2 |
| `parameters` | computation | optional | List of `{name, type, required}`; `name` and `type` required, `required` defaults to `false` | 10.2 |
| `computation` | computation | optional | A path to the computation file | 10.2, 10.3 |
| `executor`, `attester` | computation | optional | `{resource, receipt}` and `{resource}` | 10.2 |
| `integrity` | okfit | optional | Not OKF. okfit's digests; never hand-written | -- |

Extension keys are legal at any level; never delete one you do not know
(§4.1). Name your own `x-<producer>-<name>`.

Bundle-root `index.md` frontmatter may hold `okf_version` (a quoted string),
`title`, `description` (a sentence on when to use the bundle) and `license` (an
SPDX expression or a path), plus extension keys (§8.1). A subdirectory
`index.md` has no frontmatter (§8). A producer that regenerates `index.md` MUST
keep the root's frontmatter (§8.1). `log.md` has no frontmatter (§9).

## Timestamps

The timestamp keys are `generated.at`, `verified[].at`, `stale_after`,
`sources[].last_modified`, `usage_window.from` and `usage_window.to`. A value is
either an RFC 3339 date-time (`"2026-06-30T14:00:00Z"`) or a date only
(`"2026-06-30"`, which means 00:00 UTC that day). A date-time without an offset
is invalid. Write date-times for `generated.at` and `verified[].at`, because
consumers compare those two (§5).

## Trust tier

A verification is **current** when its `at` is equal to or later than
`generated.at`, or when `generated` is absent. The tier comes only from current
events: none gives unverified, only non-`human:` actors gives machine-confirmed,
a `human:<id>` gives human-reviewed. Earlier events stay as history (§5.3).
A `team:` verifier is machine-confirmed, because a team name does not identify a
person (§7). So a rewrite after a human review leaves the concept below
human-reviewed until a human confirms again. okfit lints this as
`verified-before-change` (`warn`).

## Links and path fields

One rule for body links and path fields (`resource`, `sources[].resource`,
`computation`, `executor.resource`, `attester.resource`, `superseded_by`) (§6):

1. A value with a URI scheme is an absolute URL.
2. A value starting with `/` resolves from the bundle root.
3. Any other value resolves from the directory of the file that holds it.

Both in-bundle forms are valid and consumers MUST resolve both. A value that
resolves outside the bundle root is external and is never read from disk.
Targets are URI references: percent-encode spaces; paths are case-sensitive. A
broken link is not malformed (§6.1). A `sources[].resource` may be a scope
descriptor, not a path (§5.1).

okfit treats a path field that resolves outside the bundle but inside the
project root as a repository resource: it may check that the file exists and
whether git tracks it (lints `resource-ignored`, `resource-untracked`). One
outside the project root is never touched and is reported as
`resource-outside-project` (`info`). The value is still file-relative, so a
concept under `okf/modules/` writes `../../packages/x`.

## Reserved files

`index.md` and `log.md` are reserved at every level. Producers MUST NOT use
them for concepts and consumers MUST NOT treat them as concepts, whatever they
contain (§3.1). An `index.md` body is `# Section` groups of
`* [Title](url) - description`; a `log.md` body is `## YYYY-MM-DD` entries,
newest first (§8, §9). okfit derives both with `okfit sync`.

## Actor convention

An actor is `<producer>/<version>` for an agent or tool, or `<scheme>:<id>`.
Defined schemes: `human:`, `team:`, `process:`. Other schemes are legal and
non-human (§7). Only `human:` gives the human-reviewed tier. okfit lints an
unknown prefix as `actor-prefix-unknown` (`info`) and an `@` as `actor-email`;
a person pins their id with `git config --global okfit.actor human:<id>`.

## Tolerant reading

Absent, null, empty-string and empty-list values are the same as an absent key.
A list field given one item is a list of one; a scalar `tags` is one tag and is
never split at commas. An entry missing its required key is ignored (and
SHOULD be warned about). A value outside a key's vocabulary is kept (§11.2).

## The computation locator

An Attested Computation gives its computation one of two ways (§10.3): set
`computation` to a path, or put a fenced code block in the `Computation`
section. A consumer takes `computation` when present; else the first fenced
block in the section headed `Computation`, at any heading level, ending at the
next heading of the same or higher level; else the computation is missing and
the concept is not attestable. Write exactly one fence. An agent supplies
parameter values only and never writes or edits the computation (§10.3).
Never show a value as attested without `runtime` and `attester` (§10.2).

## Changes from v0.2

Two breaking changes (§13.1):

| Change | Fallback |
| --- | --- |
| A path field without a leading `/` resolves from its file's directory. v0.2 examples wrote bundle-root paths bare, and those no longer resolve. | A consumer MAY try the bundle root when the bundle declares `okf_version` 0.2 or earlier, or none (§6.2, §12.1). okfit does this; `okf-upgrade` moves a bundle off it. |
| Only current verifications give the trust tier. | None needed: the tier can only go down. |

The computation locator is stated precisely (§10.3): the first fence in the
`Computation` section at any heading level. okfit's v0.2 reading took the body
of a depth-one `Computation` section, and okfit still applies it while a bundle
declares 0.2 or earlier, or none.

Additive changes (§13.2, §13.3):

- `superseded_by` and guidance for retiring and moving concepts.
- Root `title`, `description` and `license`.
- The `team:` scheme.
- Date-only timestamps.
- Non-concept `.md` files.

`okf-upgrade` covers the move.

A v0.1 bundle: a legacy `timestamp` stands in for `generated.at` when
`generated` is absent (Appendix B); okfit lints it as `legacy-timestamp`.

## Where the exact codec lives

`CORE/Concept.ts`, `CORE/Source.ts`, `CORE/Generated.ts`,
`CORE/Verification.ts`, `CORE/Status.ts`, `CORE/AttestedComputation.ts`,
`CORE/Timestamp.ts`. Conformant and non-conformant examples:
`packages/core/__test__/fixtures/okf/` and `.../bad/`.
