/**
 * In-memory OKF project seeds (phase 2, R1b). A seed maps project-relative posix paths to file
 * text; the bundle is always at `okf/`. Mount one with `mountProject` (utils/bundle.ts) or write it
 * to disk with the CLI's `writeSeedInto`.
 */

/** Project-relative posix path to file text. Plain strings only, so the CLI can write it to disk. */
export type ProjectSeed = Readonly<Record<string, string>>;

/** One defect per seed: the case name says which. */
export type ErrorCase =
	| "unknown-status"
	| "malformed-stale-after"
	| "superseded-by-orphan"
	| "superseded-by-unresolved"
	| "empty-required-title"
	| "resource-outside-project"
	| "resource-missing-in-repository"
	| "bare-path-under-0.3"
	| "unparsable-version";

const indexOf = (version: string | undefined): string =>
	version === undefined
		? "# Acme retail analytics\n\n* [Revenue](metrics/revenue.md)\n"
		: `---\nokf_version: ${version}\ntitle: Acme retail analytics\ndescription: Retail metrics for Acme.\n` +
			`license: CC-BY-4.0\n---\n\n# Acme retail analytics\n\n* [Revenue](metrics/revenue.md)\n`;

const REVENUE =
	"---\ntype: Metric\ntitle: Revenue\nstatus: stable\nverified:\n  - by: human:a\n    at: 2026-01-01T00:00:00Z\n---\n\n# Revenue\n\nNet revenue.\n";
const MARGIN = "---\ntype: Metric\ntitle: Margin\n---\n\n# Margin\n\nGross margin.\n";
const MARGIN_LEGACY =
	"---\ntype: Metric\ntitle: Legacy margin\nstatus: deprecated\nsuperseded_by: /metrics/margin.md\n---\n\n# Legacy margin\n\nUse [margin](/metrics/margin.md).\n";

const computation = (link: string, attester: string, extra = ""): string =>
	`---\ntype: Attested Computation\ntitle: Revenue year to date\nruntime: sql\n${extra}attester:\n  resource: ${attester}\n---\n\n` +
	`# Revenue year to date\n\nSums [revenue](${link}).\n\n## Computation\n\n\`\`\`sql\nSELECT SUM(amount) FROM sales\n\`\`\`\n`;

const WIDGET = (resource: string): string => `---\ntype: Module\ntitle: Widget\nresource: ${resource}\n---\n\n# Widget\n\nThe widget package.\n`;

const shared: ProjectSeed = {
	"okf/metrics/revenue.md": REVENUE,
	"okf/metrics/margin.md": MARGIN,
	"okf/references/attesters/check.py": "print('ok')\n",
	"packages/widget/README.md": "# Widget\n",
	"okf/README.md": "# Notes for contributors\n",
};

/** OKF 0.3 declared; every link and path field is explicit (`./`, `../` or `/`). */
export const V03_PROJECT: ProjectSeed = {
	...shared,
	"okf/index.md": indexOf('"0.3"'),
	"okf/metrics/margin-legacy.md": MARGIN_LEGACY,
	"okf/computations/revenue-ytd.md": computation("/metrics/revenue.md", "/references/attesters/check.py"),
	"okf/modules/widget.md": WIDGET("../../packages/widget"),
};

/** OKF 0.2 declared; the computation's link and attester resolve only through the root fallback. */
export const V02_PROJECT: ProjectSeed = {
	...shared,
	"okf/index.md": indexOf("'0.2'"),
	"okf/metrics/revenue.md": REVENUE.replace("---\n\n# Revenue", "stale_after: 2026-12-31\n---\n\n# Revenue"),
	"okf/metrics/margin-legacy.md": MARGIN_LEGACY,
	"okf/computations/revenue-ytd.md": computation("metrics/revenue.md", "references/attesters/check.py"),
	"okf/modules/widget.md": WIDGET("../../packages/widget"),
};

/** `V02_PROJECT` whose root index has no frontmatter, so no version is declared. */
export const UNDECLARED_PROJECT: ProjectSeed = { ...V02_PROJECT, "okf/index.md": indexOf(undefined) };

const without = (seed: ProjectSeed, ...paths: ReadonlyArray<string>): ProjectSeed =>
	Object.fromEntries(Object.entries(seed).filter(([path]) => !paths.includes(path)));

/** Each case is `V03_PROJECT` (or `V02_PROJECT` for the bare-path control) with exactly one defect. */
export const ERROR_PROJECTS: Readonly<Record<ErrorCase, ProjectSeed>> = {
	"unknown-status": { ...V03_PROJECT, "okf/metrics/margin.md": MARGIN.replace("title: Margin", "title: Margin\nstatus: bogus") },
	"malformed-stale-after": {
		...V03_PROJECT,
		"okf/metrics/margin.md": MARGIN.replace("title: Margin", "title: Margin\nstale_after: not-a-date"),
	},
	"superseded-by-orphan": {
		...V03_PROJECT,
		"okf/metrics/margin-legacy.md": MARGIN_LEGACY.replace("status: deprecated\n", "status: stable\n"),
	},
	"superseded-by-unresolved": {
		...V03_PROJECT,
		"okf/metrics/margin-legacy.md": MARGIN_LEGACY.replace("/metrics/margin.md\n", "/metrics/gone.md\n"),
	},
	"empty-required-title": { ...V03_PROJECT, "okf/metrics/margin.md": MARGIN.replace("title: Margin", "title: ''") },
	"resource-outside-project": { ...V03_PROJECT, "okf/modules/widget.md": WIDGET("../../../elsewhere") },
	"resource-missing-in-repository": {
		...without(V03_PROJECT, "packages/widget/README.md"),
		"okf/modules/widget.md": WIDGET("../../packages/widget"),
	},
	"bare-path-under-0.3": {
		...V02_PROJECT,
		"okf/index.md": indexOf('"0.3"'),
	},
	"unparsable-version": { ...V03_PROJECT, "okf/index.md": indexOf('"v0.3"') },
};
