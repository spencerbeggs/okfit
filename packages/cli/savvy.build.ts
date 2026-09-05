import { build } from "@savvy-web/bundler";

await build({
	meta: {
		tsdoc: {
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				// `Now` (validate/run.ts) is deliberately not part of index.ts's public
				// barrel (K-49: it means nothing outside a spawned process), but its
				// type still appears in `rootCommand`'s inferred requirements once a
				// subcommand that reads it (`validateCommand`, `initCommand`) is
				// registered. Suppressing the export-completeness warning for this one
				// symbol, rather than exporting it, keeps `Now` internal as designed.
				{ messageId: "ae-forgotten-export", pattern: '"Now"' },
			],
		},
	},
});
