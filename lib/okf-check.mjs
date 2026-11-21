// The root okf gate (#381): validates okfit's own okf/ bundle and checks that
// `okfit sync` has nothing left to write. Runs the workspace's own bin, so the
// result is independent of the dogfood e2e suite.
//
// - validate: errors fail the run; warnings are reported only, as workflow
//   `::warning` annotations under Actions (plain lines elsewhere).
// - sync --dry-run: a non-empty `written` list in any family fails the run.

import { spawnSync } from "node:child_process";

const okfit = (args) => {
	const run = spawnSync("pnpm", ["exec", "okfit", ...args, "--root", ".", "--format", "json"], {
		encoding: "utf8",
		env: { ...process.env, NO_COLOR: "1" },
	});
	if (run.error) throw run.error;
	let envelope;
	try {
		envelope = JSON.parse(run.stdout);
	} catch {
		console.error(`okfit ${args.join(" ")} produced no JSON (exit ${run.status}):\n${run.stdout}${run.stderr}`);
		process.exit(1);
	}
	return { status: run.status, envelope };
};

const annotate = process.env.GITHUB_ACTIONS === "true";
let failed = false;

const validate = okfit(["validate"]);
for (const d of validate.envelope.diagnostics ?? []) {
	const level = d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "notice";
	const file = d.file ? `okf/${d.file}` : "okf";
	const line = d.range?.line ?? 1;
	const text = `${d.code}: ${d.message}`;
	console.log(annotate ? `::${level} file=${file},line=${line}::${text}` : `${level} ${file}:${line} ${text}`);
}
const s = validate.envelope.summary;
const errors = s.conformance_errors + s.lint_errors + s.profile_errors;
console.log(`validate: ${errors} errors, ${s.lint_warnings} warnings, ${s.concepts} concepts`);
if (validate.status !== 0) failed = true;

const sync = okfit(["sync", "--dry-run"]);
const pending = ["generated", "index", "log"].flatMap((family) =>
	(sync.envelope[family]?.written ?? []).map((path) => `${family}: ${path}`),
);
if (sync.status !== 0 || pending.length > 0) {
	failed = true;
	console.error(
		`sync --dry-run would write ${pending.length} file(s); run \`pnpm exec okfit sync\`:\n  ${pending.join("\n  ")}`,
	);
} else {
	console.log("sync --dry-run: nothing to write");
}

process.exit(failed ? 1 : 0);
