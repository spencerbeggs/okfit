import type { LoadedBundle, OkfitConfig } from "@okfit/core";
import type { Layout, Profile, ProfileDiagnostic, ProfileDiagnosticCode } from "./Profile.js"; // (checked) contract section 2 lists Layout, Profile, ProfileDiagnostic; ProfileDiagnosticCode is added type-only for the local `diagnostic` helper and changes no exported surface

/**
 * Hand-authored, typed `OkfitConfig` (P-25). Sets ONLY `concepts`, `types`,
 * `tags` and `extensions: {}`; `okf_version`, `bundle`, `lifecycle`, `actors`
 * and `lint` are inherited from `OkfitConfig.DEFAULTS` by whoever merges.
 * `actors.agent` is deliberately unset (P-17): which agent writes is a fact
 * about the repository, not about the software-project shape. Every string
 * obeys P-42 (one-sentence descriptions, at most two-sentence guidance, plain
 * text). No explicit `required = []` anywhere (P-20). The literal type-checks
 * as `OkfitConfig` without a decode step because no branded `Actor` is set
 * (`CORE/OkfitConfig.ts:172`; `OkfitConfig.test.ts:102-107` precedent).
 */
const config: OkfitConfig = {
	concepts: { required: ["title", "description"], tags: { required: [] } },
	types: {
		Project: {
			description: "The repository's root concept: its purpose, boundaries, and non-goals.",
			guidance:
				"Exactly one Project exists and it lives at the bundle root as the project file. State the purpose in one paragraph and list what is deliberately out of scope so a reader never infers boundaries from silence.",
		},
		Module: {
			description: "A unit of code with an owner and a boundary.",
			guidance:
				"One per workspace package, plugin, website, or action. Link to the Decisions that shaped it and the Conventions it is bound by.",
			required: ["resource", "kind"],
			fields: {
				kind: {
					description: "What sort of unit this is; drives which conventions apply.",
					values: {
						workspace: "The monorepo root: tooling, CI, release, shared config.",
						package: "A publishable npm package under packages/.",
						website: "A docs or marketing site, usually RSPress.",
						plugin: "A Claude Code or editor plugin distributed outside npm.",
						action: "A GitHub Action.",
					},
				},
				resource: {
					description:
						"A path from the bundle root to the code this Module documents, normally escaping the bundle, for example ../packages/core.",
					kind: "path",
				},
			},
		},
		Decision: {
			description: "A choice made, the alternatives rejected, and why.",
			guidance:
				"Never edit a stable Decision; deprecate it and write a new one that names it in supersedes. A Decision counts as settled only once a human has verified it.",
			require_verified: true,
			fields: {
				supersedes: { description: "The Decision this one replaces.", kind: "path" },
			},
		},
		Convention: {
			description: "A rule contributors and agents must follow.",
			guidance:
				"State the rule as an instruction rather than a description of current behaviour. Give it a staleness window so it is re-examined on a cadence instead of rotting silently.",
		},
		Interface: {
			description: "A contract others depend on.",
			guidance:
				"Document the contract from the consumer's side: what stays stable, not how it is built. Point resource at the file, endpoint, or schema the promise lives in.",
			required: ["kind"],
			fields: {
				kind: {
					description: "What kind of contract this is.",
					values: {
						api: "A programmatic library surface: exported functions, classes, and types.",
						cli: "A command-line interface: commands, flags, and exit codes.",
						config: "A configuration file schema other tools read or write.",
						wire: "A network or IPC wire format.",
						mcp: "An MCP tool or resource surface.",
					},
				},
				resource: {
					description:
						"A path from the bundle root to the file, endpoint, or schema this Interface documents, normally escaping the bundle, for example ../packages/core/src/index.ts.",
					kind: "path",
				},
			},
		},
		Reference: {
			description: "Mirrored external material kept under the references directory.",
			guidance:
				"Only for material this repository must cite reliably even if the original moves. Every Reference declares where it came from in sources.",
			required: ["sources"],
		},
	},
	tags: {
		architecture: { description: "Concerns the shape of the system rather than one module." },
		testing: { description: "Concerns how the system is verified: strategy, fixtures, and coverage policy." },
		release: { description: "Concerns how changes ship: versioning, changelogs, publishing, and tagging." },
		security: { description: "Concerns trust boundaries, secrets, permissions, or attack surface." },
		performance: { description: "Concerns speed, memory, or resource cost and the trade-offs made for them." },
	},
	extensions: {},
};

/** Spec 5.2 as data (P-26); consumed by `okfit init`, never by validation. */
const layout: Layout = {
	root: { index: "index.md", log: "log.md", project: "project.md" },
	directories: [
		{ directory: "modules", type: "Module" },
		{ directory: "decisions", type: "Decision" },
		{ directory: "conventions", type: "Convention" },
		{ directory: "interfaces", type: "Interface" },
		{ directory: "references", type: "Reference" },
	],
};

const PROJECT_TYPE = "Project";

const diagnostic = (file: string, code: ProfileDiagnosticCode, message: string): ProfileDiagnostic => ({
	file,
	code,
	severity: "error",
	message,
});

/** Plain code-unit order on `file` then `code` (decision 6); never locale-dependent. */
const compare = (a: ProfileDiagnostic, b: ProfileDiagnostic): number => {
	if (a.file < b.file) return -1;
	if (a.file > b.file) return 1;
	if (a.code < b.code) return -1;
	if (a.code > b.code) return 1;
	return 0;
};

/**
 * Exactly one `Project`, at the bundle root (P-21). Pure over `bundle.concepts`
 * (`CORE/Bundle.ts:98`; `Concept.type` `CORE/Concept.ts:27`). The rules are
 * independent: two Projects with one nested yield three diagnostics. The file
 * name `project.md` is layout guidance, not checked. Severity is always
 * `error`; no `range`. Output is sorted by `file` then `code`.
 */
const check = (bundle: LoadedBundle): ReadonlyArray<ProfileDiagnostic> => {
	const projects = [...bundle.concepts.values()].filter((concept) => concept.frontmatter.type === PROJECT_TYPE);
	const out: Array<ProfileDiagnostic> = [];
	if (projects.length === 0) {
		out.push(
			diagnostic(
				"",
				"project-missing",
				`No Project concept in the bundle; software-project expects exactly one at the bundle root (${layout.root.project})`,
			),
		);
	}
	if (projects.length > 1) {
		for (const project of projects) {
			const others = projects
				.filter((other) => other !== project)
				.map((other) => other.path)
				.sort();
			out.push(
				diagnostic(
					project.path,
					"project-multiple",
					`Project concept "${project.path}" is one of ${projects.length}; software-project expects exactly one (others: ${others.join(", ")})`,
				),
			);
		}
	}
	for (const project of projects) {
		if (project.path.includes("/")) {
			out.push(
				diagnostic(
					project.path,
					"project-not-at-root",
					`Project concept "${project.path}" is below the bundle root; software-project expects it beside ${layout.root.index}`,
				),
			);
		}
	}
	return out.sort(compare);
};

/**
 * The `software-project` profile (spec 5; P-20 to P-26, P-42). Reachable
 * publicly only as `Profiles.softwareProject` (P-38).
 *
 * @public
 */
export const softwareProject: Profile = { name: "software-project", config, layout, check };
