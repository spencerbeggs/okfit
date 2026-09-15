/**
 * The whole schema setup for okfit: `okfitConfigDocumentFields` (`@okfit/core`)
 * becomes the published `config` JSON Schema document, hosted at
 * `okfitConfigSchemaHost` — the same `HostedSchema` `okfit init` reads to
 * stamp the `#:schema` directive, so the URL a fresh config points at and the
 * one this build writes can never disagree. Run via `pnpm schema:build` /
 * `pnpm schema:check` (`okf/interfaces/okfit-config-schema.md`).
 */
import { defineConfig } from "@effected/schemastore";
import { okfitConfigDocumentFields } from "@okfit/core";
import { okfitConfigSchemaHost } from "../../src/init/scaffold.js";

export default defineConfig({
	outputDir: "../../../../schemas",
	schemas: {
		[okfitConfigSchemaHost.name]: {
			schema: okfitConfigDocumentFields,
			hosted: okfitConfigSchemaHost,
			published: false,
			catalog: {
				description: "okfit config file for an Open Knowledge Format (OKF) bundle",
				fileMatch: ["okfit.toml", ".okfit.toml", "**/.config/okfit.toml"],
			},
		},
	},
});
