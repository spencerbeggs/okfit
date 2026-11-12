/**
 * The whole schema setup for okfit: `okfitConfigDocumentFields` becomes the
 * published `config` JSON Schema document, hosted at `okfitConfigSchemaHost`
 * — the same `HostedSchema` `@okfit/engine`'s `init` reads to stamp the
 * `#:schema` directive, so the URL a fresh config points at and the one this
 * build writes can never disagree. Run via `pnpm schema:build` /
 * `pnpm schema:check` (`okf/interfaces/okfit-config-schema.md`).
 *
 * `@effected/plugin` bundles its own `@effected/schemastore`, whose
 * `HostedSchema` is nominally distinct from the one core builds with, so the
 * host is rebuilt from the plugin's class out of core's own fields: the
 * identity still comes from one place.
 */
import { HostedSchema, defineSchemastore } from "@effected/plugin";
import { okfitConfigDocumentFields, okfitConfigSchemaHost } from "../../src/OkfitConfig.js";

export default defineSchemastore({
	outputDir: "../../../../schemas",
	name: "okfit",
	schemas: {
		[okfitConfigSchemaHost.name]: {
			schema: okfitConfigDocumentFields,
			hosted: new HostedSchema({ ...okfitConfigSchemaHost }),
			published: false,
			catalog: {
				description: "okfit config file for an Open Knowledge Format (OKF) bundle",
				fileMatch: ["okfit.toml", ".okfit.toml", "**/.config/okfit.toml"],
			},
		},
	},
});
