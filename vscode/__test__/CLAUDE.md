# Test Directory

This project uses `@vitest-agent/plugin` for test discovery. Tests live here in
`__test__/`, not co-located in `src/` or `server/`.

## Directory Structure

```text
__test__/
  manifest.test.ts    # Marketplace-manifest field and packaging assertions
```

## Rules

- **Classification is by filename, not location.** `*.e2e.test.ts` would be
  e2e regardless of which directory it sits in; none exist yet.
- **Never put test files in `src/` or `server/`.** All tests belong in
  `__test__/`.
- **Never inline large test data in test files.** Extract it to a
  `fixtures/` directory once one is needed.
