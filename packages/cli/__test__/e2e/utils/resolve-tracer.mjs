// Preloaded with `node --import`: appends every resolved module specifier to
// the file named by OKFIT_TRACE_FILE, so a test can prove what a run never loaded.
import { appendFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
	resolve(specifier, context, nextResolve) {
		const file = process.env.OKFIT_TRACE_FILE;
		if (file !== undefined) appendFileSync(file, `${specifier}\n`);
		return nextResolve(specifier, context);
	},
});
