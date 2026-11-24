---
"@okfit/lsp": minor
---

## Breaking Changes

- Trust tiers now follow OKF 0.3 §5.3: only verification events dated at or after a concept's last change count. A concept verified before its last change used to read `human-reviewed` or `machine-confirmed` and now reads `unverified`, in hover, in the inlay hint and on the `okfit/concepts` wire. The inlay hint names the newest current human verifier. Re-verify such concepts with `okfit verify`.
- The verify code action and command are no longer offered, and are refused, when they would write a verification dated before the concept's `generated.at`; the refusal message says to check the clock.

## Features

- The "already verified" check now reads `generated`, so a concept verified before its last change is offered the verify action again.
