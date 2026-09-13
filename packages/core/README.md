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
 const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, yield* OkfitConfig.read("/repo/.config/okfit.toml"));
 const bundle = yield* Bundle.load({ root: "/repo/okf" });
 return Validate.all(bundle, config);
});
```

`Bundle.load` needs `FileSystem` and `Path`; `OkfitConfig.read` needs `FileSystem`. Loading never fails on content: bad files become `Diagnostic`s. `Graph.fromBundle` treats a path-valued field or link whose target, resolved from its concept's directory, lands outside the bundle root as an external reference: no graph node and no `broken-links` diagnostic, exactly like a URL. `OkfitConfig` decodes the spec 4.2 TOML shape; unknown top-level keys are kept in `extensions` and reported by `Validate.lint` as `config-unknown-key`. `lifecycle.default_stale_after` accepts `90d`, `12h`, `2w`, or `"90 days"`. `OkfitConfig.merge` deep-merges tables; arrays and scalars in `override` replace wholesale. Apply `DEFAULTS < profile < file` yourself. `OkfitConfigFile` is the service tag; the CLI provides its layer. `okfitConfigDocumentFields` is `okfitConfigFields` minus `extensions` (wire bookkeeping no human writes), with an open rest so unknown top-level keys stay permitted while every declared table stays closed; it is the single source `lib/scripts/generate-schema.ts` builds the published JSON Schema (`schemas/config/okfit-1.0.0.json`) from, and carries no annotations of its own beyond what each field already declares in `OkfitConfig.ts`. The `[lint]` table's seventeen keys include `generated_at_drift` (default `"warn"`), which fires when a committed concept's `generated.at` no longer matches the instant its body was last changed AND is not otherwise authoritative (issue #19: a stamp recorded during the unchanged-body run survives a squash/rebase merge) — computed by `okfit sync`/`okfit validate`, never by core itself.

## License

[MIT](LICENSE)
