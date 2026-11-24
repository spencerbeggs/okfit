---
"@okfit/cli": minor
---

## Breaking Changes

Trust tiers, `--unverified` and the `verify` skip rule now follow OKF 0.3 §5.3. Only verification events dated at or after a concept's last change count, so concepts you changed after verifying them now report a lower tier, show up under `--unverified`, and are picked up again by `okfit verify --all`, `--type` and the batch commands. `okfit verify --at <time>` earlier than the concept's `generated.at` is refused with exit code 3. Re-run `okfit verify` on concepts that now warn.

## Features

- `okfit validate` and `okfit lint` report the new `verified-before-change` lint, which names the verifier, the verification time and the later change.
- The `verify` confirm prompt explains a verification made before the last change.
- Help text for `--all`, `--type`, `--at` and `--unverified` describes the current-verification rule.
