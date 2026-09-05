# Vendored: OKF v0.2 sample bundles

- **Upstream:** [GoogleCloudPlatform/knowledge-catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog), directory `okf/bundles/`
- **Commit:** `fbbc7975388288244dfc62aea0066600b25b7c47` (2026-09-02)
- **Tree:** <https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/fbbc7975388288244dfc62aea0066600b25b7c47/okf/bundles>
- **License:** Apache-2.0; `LICENSE.md` beside this file is upstream `okf/LICENSE.md` verbatim (its copyright line is the unfilled template upstream; no NOTICE file exists upstream)
- **Vendored via:** `./vendor.sh` (curl of raw URLs at the pinned commit; okfit has no `.repos/` entry for this source)
- **Forward-looking home:** [GoogleCloudPlatform/open-knowledge-format](https://github.com/GoogleCloudPlatform/open-knowledge-format); its `acme_retail` and `stackoverflow` trees differ from this snapshot, so refreshes must re-pin deliberately

## What this is

The four sample bundles the OKF v0.2 reference agent ships, copied verbatim
except for the four generated `viz.html` viewers (CDN-loaded Cytoscape pages,
never link targets, 235 KB; regenerate upstream). `acme_retail/attesters/sql_equality.py`
is kept: it is a body-link and `attester.resource` target the graph tests resolve.

| Bundle | Tree SHA at the commit | Files | `.md` | Concepts | `index.md` | `log.md` |
| --- | --- | --- | --- | --- | --- | --- |
| `acme_retail` | `55db69ce76f1aebddcf3e21210bf15128902184c` | 18 | 17 | 9 | 7 | 1 |
| `crypto_bitcoin` | `d66558f22cd385c328ff76c0b4e03084453c302e` | 15 | 15 | 9 | 6 | 0 |
| `ga4` | `7f4a8430196381e96ac2eb76b4ec0d0b4dbd01cb` | 14 | 14 | 9 | 5 | 0 |
| `stackoverflow` | `76c1f044b8c617c5b309dbe3dbd117ff94499f14` | 32 | 32 | 26 | 6 | 0 |
| total | | 79 | 78 | 53 | 24 | 1 |

`__test__/fixtures.test.ts` asserts these counts; update both together.

## Attribution posture

Test-only vendoring: consumed exclusively by `__test__/` (seeded into
`@effected/memfs`), never shipped. Apache-2.0 sections 4(a)-(c) are satisfied
by the license copy and this file. Never hand-edit; re-run `./vendor.sh`.
