# @okfit/core

Spec-level [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) v0.2 support for [Effect](https://effect.website): frontmatter schemas, bundle loading, the concept link graph, trust and staleness derivation, and conformance validation.

> **Pre-release.** Part of the `@okfit/*` kit, in early development against a single pinned Effect v4 prerelease.

## Install

```bash
pnpm add @okfit/core effect
```

## Usage

```ts
import { Bundle, OkfitConfig, Validate } from "@okfit/core";
import { Effect } from "effect";

const program = Effect.gen(function* () {
 const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, yield* OkfitConfig.read("/repo/.config/okfit/config.toml"));
 const bundle = yield* Bundle.load({ root: "/repo/okf" });
 return Validate.all(bundle, config);
});
```

`Bundle.load` needs `FileSystem` and `Path`; `OkfitConfig.read` needs `FileSystem`. Loading never fails on content: bad files become `Diagnostic`s. `OkfitConfig` decodes the spec 4.2 TOML shape; unknown top-level keys are kept in `extensions` and reported by `Validate.lint` as `config-unknown-key`. `lifecycle.default_stale_after` accepts `90d`, `12h`, `2w`, or `"90 days"`. `OkfitConfig.merge` deep-merges tables; arrays and scalars in `override` replace wholesale. Apply `DEFAULTS < profile < file` yourself. `OkfitConfigFile` is the service tag; the CLI provides its layer.

## License

[MIT](LICENSE)
