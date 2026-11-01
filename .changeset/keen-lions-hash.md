---
"@okfit/profiles": minor
---

## Breaking Changes

The digest and lint helpers now require core's `Digest.Digest` service (from `effect/crypto`) instead of `Crypto.Crypto`, which Effect 4.1 removed. This affects `Derivation.digestFull`, `Derivation.digest`, `Derivation.bodyDigest`, `Derivation.contentDigest`, `Provenance.lint`, `Publications.lint`, `Trust.signal`, `Trust.signals` and `Trust.lint`. The digest functions' error channel is now `never` (no more `PlatformError`). Digests are byte-identical to before.

To migrate, provide a `Digest` layer where you previously provided `Crypto`:

```typescript
import { NodeCrypto } from "@effect/platform-node";
import { Effect } from "effect";

program.pipe(Effect.provide(NodeCrypto.layerDigest));
```

* Content digests now canonicalize through `@effected/jsonc`'s `JsoncFingerprint` (RFC 8785, relaxed for `bigint`, `undefined`, non-finite numbers and `toJSON`). Existing digests are byte-identical. `Canonical.json` is removed, and `Canonical.contentInput` now returns a `Result`.
* A frontmatter value holding an unpaired surrogate (a YAML `"\uD800"` escape) is no longer hashed. `Derivation.contentDigest` fails with the new `ContentUnhashableError`, which names the frontmatter path. `Trust` reports a bound concept like that as drifted with the new `DriftReason` `content-unhashable`, and its `verified-drift` finding is ranged at the offending value.
