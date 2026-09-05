---
name: okf-spec
description: >-
  OKF v0.2 condensed reference: the conformance floor, the frontmatter field
  table by family, reserved files, the actor convention, cross-linking rules,
  and the v0.1-to-v0.2 changes. Use when authoring or reviewing an OKF concept
  file, deciding which frontmatter fields to set, or checking whether a bundle
  is conformant. Trigger phrases -- "what fields does OKF support", "is
  verified required", "what changed from 0.1 to 0.2", "actor convention",
  "frontmatter reference table", "is this concept conformant".
---

# OKF Spec

## What OKF is

An OKF bundle is a directory tree of UTF-8 markdown files, each an optional
YAML frontmatter block (delimited by `---` lines) followed by a free-form
markdown body. There is no central schema registry: producers organize
concepts however suits the knowledge, and the layout is domain-independent
(spec §3, **unverified against upstream** -- the upstream `SPEC.md` is not
vendored in this repo; see `OKFSPEC-NOTE:404-405`). A bundle is distributable
as a git repository (recommended, for history/attribution/diffs), a
tarball/zip, or a subdirectory of a larger repository. Only `index.md` and
`log.md` are reserved (see below); every other `.md` file is a concept
document.

## Conformance floor

Lead with this fact, because it is what stops an authoring agent from
inventing required fields that do not exist: **a concept carrying only a
non-empty `type` in its frontmatter is fully conformant** (spec §11,
**unverified against upstream**, `OKFSPEC-NOTE:406-409`). Everything else in
the table below is recommended or optional -- never treat it as required
unless the active profile or config says so (see `okf-authoring` rule 1).

Spec §11 states this as three rules: (1) every non-reserved `.md` file has
parseable YAML frontmatter, (2) every frontmatter block has a non-empty
`type`, (3) reserved filenames follow the §8/§9 structure when present.
Consumers MUST NOT reject a bundle for missing optional frontmatter, an
unknown `type`, unknown extra keys, broken links, or a missing `index.md`.

## Frontmatter reference table

| Field | Family | Required | Notes | Spec § |
| --- | --- | --- | --- | --- |
| `type` | core | **yes** -- the only always-required key | Short string, not centrally registered; consumers MUST tolerate unknown types | §4.1 |
| `title` | core | recommended | Else derive from the filename | §4.1 |
| `description` | core | recommended | One sentence; used by index generators and search | §4.1 |
| `resource` | core | recommended | Canonical URI of the underlying asset; absent for abstract concepts | §4.1 |
| `tags` | core | recommended | YAML list of free strings | §4.1 |
| `sources` | provenance | optional | List of provenance entries | §5.1 |
| `sources[].resource` | provenance | **required within each entry** | A concrete artifact path or URL, or a scope descriptor | §5.1 |
| `sources[].id` | provenance | optional | Stable footnote key; SHOULD be present when the body cites the source | §5.1 |
| `sources[].title` | provenance | optional | -- | §5.1 |
| `sources[].author` | provenance | optional | A credibility signal; an actor (§7) | §5.1 |
| `sources[].usage_count` | provenance | optional | Coarse exercise count over `usage_window`; liveness only | §5.1 |
| `sources[].last_modified` | provenance | optional | The source's own recency, distinct from `generated.at` | §5.1 |
| `usage_window` | provenance | optional | `{from, to}`; frames every entry's `usage_count` unless the entry overrides it | §5.1 |
| `generated.by` | trust | **required within `generated`** | An actor (§7). `CORE/Generated.ts:10` -- not `optionalKey` | §5.2 |
| `generated.at` | trust | spec prose gives no explicit marker (ambiguous); **core treats it as optional** -- `CORE/Generated.ts:11` is `Schema.optionalKey(Timestamp)` | Content's last meaningful change | §5.2 |
| `verified` | trust | optional | A **list** of `{by, at}`; a bare mapping is legal input and MUST be read as a one-element list | §5.2 |
| `status` | lifecycle | optional | `draft \| stable \| deprecated`; absent means `stable` | §5.4 |
| `stale_after` | lifecycle | optional | Absolute ISO 8601 instant; stale when `now >= stale_after` | §5.5 |
| `runtime` | computation | spec prose says REQUIRED for an Attested Computation; **core demotes an absent value to lint `computation-runtime-missing`**, whose default severity is `error` (`CORE/OkfitConfig.ts:277`) but which is a lint, not a rejection (D-20) | e.g. `bigquery`, `postgres`, `dbt`, `python`, `Looker` | §10.2 |
| `parameters` | computation | optional | List of `{name, type, required}` | §10.2 |
| `computation` | computation | optional | A path; mutually exclusive with an inline `# Computation` body fence | §10.2, §10.3 |
| `executor` | computation | optional | `{resource, receipt}` | §10.2 |
| `attester` | computation | optional | `{resource}`; deterministic, non-LLM, run consumer-side | §10.2 |

**Every timestamp field** (`generated.at`, `verified[].at`, `stale_after`,
`sources[].last_modified`, `usage_window.{from,to}`) needs an explicit UTC
offset. Core enforces it before parsing -- `CORE/Timestamp.ts:6` is
`/(?:Z|[+-]\d{2}:\d{2})$/` and `:25-30` fails offset-less input with
"Expected an ISO 8601 timestamp with an explicit offset (Z, +hh:mm or
-hh:mm)".

Where core is looser or stricter than the spec prose, this skill states
**core's** behaviour as the operative rule and cites the lint code -- D-18 for
actor prefixes, D-20 for `computation-runtime-missing`, D-33/D-34 for the
severity split. It never leaves the reader to reconcile the two.

## Reserved files

`index.md` (a directory listing, §8) and `log.md` (an update history, §9) are
reserved at any level of the hierarchy and MUST NOT be used as concept
documents. `okf_version` is legal only in a bundle-root `index.md`'s
frontmatter (`OKFSPEC-NOTE:416-417`) -- it is the sole permitted frontmatter
key there, and no other `index.md` or any `log.md` carries frontmatter at
all. An `index.md` body is one or more `# Section Heading` groups of `*
[Title](url) - description` bullets; a `log.md` body is a flat list of `##
YYYY-MM-DD` date-grouped entries, newest first.

## Actor convention

An actor string is one of three forms: `<producer>/<version>` (an agent or
tool), `human:<id>` (a person), or `process:<id>` (an automated process).

Core's operative rule (D-18) is more permissive than a strict three-form
reading: `CORE/Actor.ts:5` accepts any string matching
`^(?:[^\s/:]+\/[^\s]+|[A-Za-z][A-Za-z0-9_-]*:[^\s]+)$`, and
`CORE/Actor.ts:22-28`'s `form` classifies an unrecognised prefix as `"other"`,
driving lint `actor-prefix-unknown` at severity `info`
(`CORE/OkfitConfig.ts:280`) -- never a rejection.

## Links

A bundle-relative link (`/tables/customers.md`) is recommended: it stays
stable when a file moves within a subdirectory. A relative link
(`./other.md`) is also legal. A link asserts an untyped relationship; the
kind (parent/child, joins-with, depends-on) is conveyed by surrounding prose,
not the link itself. Consumers MUST tolerate broken links --
(`OKFSPEC-NOTE:419-420`) a broken link may represent not-yet-written
knowledge, not a defect.

The path-valued frontmatter fields (`resource`, `sources[].resource`,
`computation`, `executor.resource`, `attester.resource`) each accept an
absolute URL, a bundle-relative path, or a relative path;
`sources[].resource` may instead be a scope descriptor rather than a path
(§5.1). The `references/` directory name is a naming convention, not a
requirement, for mirroring external material as first-class concepts that
sources/executors/attesters commonly point into.

## Changes from v0.1

Breaking: `timestamp` is superseded by `generated.at` (`generated: {by,
at}`); consumers MAY fall back to a legacy `timestamp` when `generated` is
absent. Core stamps `Generated.LEGACY_BY = "process:legacy-timestamp"`
(`CORE/Generated.ts:14`) as the actor when a v0.1 `timestamp` is folded into
`generated.at` (D-15) -- a v0.1 document has no actor of its own to credit.

Breaking: the body `# Citations` list is superseded by the `sources`
frontmatter field; consumers SHOULD read `sources` and MAY still parse a
legacy `# Citations` list for v0.1 documents.

An Attested Computation (§10.1) is used, informally, by: discover, load its
contract and computation, parameterize, execute for a receipt, attest
(re-derive and compare), gate (refuse display on a failing attestation or
staleness) -- §10.5's narrative, informative only. `verified` (doc-level,
confirms the definition matches policy) is distinct from an attestation
(per-run, confirms one execution was produced the sanctioned way, and is
never stored in the bundle) -- §10.6.

## Where the exact codec lives

The exact frontmatter codecs, no restatement here: `CORE/Concept.ts`,
`CORE/Source.ts`, `CORE/Generated.ts`, `CORE/Verification.ts`,
`CORE/Status.ts`, `CORE/AttestedComputation.ts`, `CORE/Timestamp.ts`.

Conformant and non-conformant examples:
`packages/core/__test__/fixtures/okf/` (the vendored `acme_retail`,
`crypto_bitcoin`, `ga4`, and `stackoverflow` sample bundles -- test-only
fixtures, never shipped) and `.../bad/` (22 entries -- counted this session,
not 26) for the failure modes described above and more, e.g.
`bare-verified`, `legacy-timestamp`, `computation-runtime-missing`,
`broken-link`, `missing-type`.
