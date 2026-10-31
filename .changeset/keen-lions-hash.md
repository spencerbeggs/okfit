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
