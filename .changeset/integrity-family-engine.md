---
"@okfit/engine": minor
---

## Breaking Changes

### JSON envelopes

* `SyncEnvelope` mode results gain a `migrated` id list.
* `PublicationEnvelope.digests[].body_sha256` is renamed to `digests[].body` and now holds a 16-hex digest. A consumer of `okfit sync --publication --format json` must read `body`.
* `VerifyEnvelope` gains an optional `prior_integrity` (`content-changed`, `unbound` or `entry-superseded`), present only when the concept's prior human verification had drifted. The envelope does not report the new binding itself.
* `SkipReason` gains `integrity-unsupported` and `renders-unsupported`; an exhaustive switch over it must handle both.

### Signatures

* `FrontmatterEdits.verified` and `FrontmatterEdits.verifiedWithStatus` take a required `content` argument, the content digest the new `integrity.verified` binding records.
* `selectAttestable`, `selectPickerCandidates` and `selectStaleCandidates` take a required `signals` map (`Trust.signals` from `@okfit/profiles`), so drifted concepts are offered again.

Migration: compute the signals once per bundle with `Trust.signals(bundle, now)` and pass them through; compute `content` with `Derivation.contentDigest(concept.frontmatter.raw, source)`.

## Features

* `okfit sync` stamps `integrity.generated.body` and migrates legacy `generated.body_sha256` and Publication `renders[].body_sha256` digests to the new family, counting migrated concepts
* Verify binds `integrity.verified { by, at, content }` to a digest of the body plus authored frontmatter
* Batch verify and the picker re-offer concepts that drifted since verification
* New exports: `runRevoke` (with `RevokeOptions`, `RevokeResult`), `RevokeEnvelope` and `revokeEnvelope`, `VerifyNothingToRevokeError`, `inspectDrift` (with `DriftInspection`), and `changeSince` (with `ChangeSince`) for the git diff since a concept was last verified
