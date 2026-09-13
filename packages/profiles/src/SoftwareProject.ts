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
				"One per workspace package, plugin, website, action, test harness, or config dependency. Link to the Decisions that shaped it and the Conventions it is bound by.",
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
						harness:
							"A private test-only package or package group that exercises built artifacts and is never published.",
						"config-dependency":
							"A package consumed through pnpm configDependencies rather than dependencies, loaded before the workspace resolves.",
					},
				},
				resource: {
					description:
						"A path relative to this concept file, normally escaping the bundle, for example ../../packages/core.",
					kind: "path",
				},
				layer: {
					description:
						"The dependency layer this module sits in under the repository's own layering scheme, for example L2, so a reader can query every module at one layer.",
				},
				pins: {
					description:
						"Paths to the sibling Module concepts this module is exact-version-pinned alongside, one entry per sibling.",
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
						runtime:
							"A runtime binding or platform capability consumers invoke rather than a shape they write: worker bindings, environment contracts, platform flags.",
					},
				},
				resource: {
					description:
						"A path relative to this concept file, normally escaping the bundle, for example ../../packages/core/src/index.ts.",
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
		Runbook: {
			description: "A repeatable operational procedure with a trigger and an observable end state.",
			guidance:
				"Write the steps in the order they are performed, not as rules. Name the trigger that starts the procedure and the observable state that means it succeeded.",
			fields: {
				resource: {
					description:
						"A path relative to this concept file to the script, workflow, or config the procedure runs through, when one exists in this repository.",
					kind: "path",
				},
			},
		},
		Glossary: {
			description: "A term this repository uses in its own sense, one term per concept.",
			guidance:
				"Define the term as this repository means it, not as the wider ecosystem means it, and say plainly where the two differ. A term earns a concept on a collision or a trap; one that merely names a Module belongs in that Module.",
		},
		Limitation: {
			description: "A known edge of a contract: something that does not work, and why that is acceptable.",
			guidance:
				"State the condition that triggers it and the observable symptom, not just the cause, and name the Interface or Module whose promise it bounds. If it is fixable and merely unfixed, say what the fix would take.",
			fields: {
				bounds: {
					description: "The Interface or Module concept whose promise this limitation bounds.",
					kind: "path",
				},
			},
		},
		DataModel: {
			description: "An internal source-of-truth structure that other artifacts are derived from.",
			guidance:
				"Document the shape from the maintainer's side: what an entry contains, what is derived from it, and what breaks if an entry is wrong. Distinct from Interface, which documents a promise to consumers.",
			required: ["resource"],
			fields: {
				resource: {
					description:
						"A path relative to this concept file, normally escaping the bundle, to the file or directory that holds the structure.",
					kind: "path",
				},
			},
		},
		Gotcha: {
			description:
				"A state or result that looks like one thing and is the opposite: breakage that is transient, or success that did nothing.",
			guidance:
				"Describe what a reader sees, what they will wrongly conclude, and what is actually true, and point resource at the code or command that produces the misleading signal. Give it a staleness window, since a trap fixed upstream turns into misinformation.",
			fields: {
				resource: {
					description:
						"A path relative to this concept file to the code, script, or config that produces the misleading signal.",
					kind: "path",
				},
			},
		},
	},
	tags: {
		architecture: { description: "Concerns the shape of the system rather than one module." },
		testing: { description: "Concerns how the system is verified: strategy, fixtures, and coverage policy." },
		release: { description: "Concerns how changes ship: versioning, changelogs, publishing, and tagging." },
		security: { description: "Concerns trust boundaries, secrets, permissions, or attack surface." },
		performance: { description: "Concerns speed, memory, or resource cost and the trade-offs made for them." },
		dx: { description: "Concerns the experience of the people and agents who author, build, and debug the code." },
		ci: { description: "Concerns the unattended path: what runs without a human present, and how it fails." },
		compat: {
			description: "Concerns compatibility across versions of the runtime, the package manager, or a dependency.",
		},
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
		{ directory: "runbooks", type: "Runbook" },
		{ directory: "glossary", type: "Glossary" },
		{ directory: "limitations", type: "Limitation" },
		{ directory: "models", type: "DataModel" },
		{ directory: "gotchas", type: "Gotcha" },
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
