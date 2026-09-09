import { build } from "@savvy-web/bundler";

await build({
	meta: {
		tsdoc: {
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				// `Now` (validate/run.ts) IS exported from the barrel (index.ts). K-49
				// kept it out of the barrel when commands/ and validate/run.ts lived
				// in one package, but they are now split across cli and engine, and a
				// cross-package import cannot reach into src/, so cli's main.ts can
				// only get `Now` through this barrel. It keeps its @internal TSDoc
				// tag; API Extractor still flags its anonymous base as an
				// ae-forgotten-export since the class never gets its own @public
				// declaration.
				{ messageId: "ae-forgotten-export", pattern: '"Now"' },
			],
		},
	},
});
