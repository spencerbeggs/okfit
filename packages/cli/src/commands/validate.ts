import { CliExit, CliFormat } from "@effected/cli-kit";
import { Git } from "@effected/git";
import { CurrentDistribution } from "@effected/kit";
import { OKF_SPEC_VERSION, OkfVersion } from "@okfit/core";
import type { JsonFixes, MigrationFixKind } from "@okfit/engine";
import {
	JsonEnvelope,
	Now,
	Targets,
	applyMigrationFixes,
	collect,
	forDiagnostics,
	json,
	jsonError,
	planMigrationFixes,
	provideConfig,
	provideDocuments,
	resolveProjectConfig,
	run,
} from "@okfit/engine";
import { GitHistory } from "@okfit/profiles";
import { Console, Effect, Layer, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { printDiagnostics } from "../internal/print-diagnostics.js";
import { rootFlag } from "../internal/root.js";
import { scopeTo } from "../internal/scope.js";
import { readDocumentText } from "../internal/stdin.js";
import { ValidateUsageError } from "../internal/validate-usage.js";
import { CLI_VERSION } from "../version.js";

/** K-1: no `mustExist` — the handler stats the path itself, before building any layer. */
const configFlag = Flag.File("config").pipe(
	Flag.optional,
	Flag.withDescription("explicit config file; skips discovery"),
);

/** K-6: `--format` is on `validate` only. */
const formatFlag = CliFormat.flag<"json", { readonly human: "auto" }>(["json"], {
	aliases: { human: "auto" },
	default: "human",
	description: "output format: human (default) or json",
});

/** Scope: report only these files' diagnostics; the bundle still loads whole so link lints stay right. */
const targetsArg = Argument.String("targets").pipe(
	Argument.variadic({ min: 0 }),
	Argument.withDescription(
		"only report diagnostics for these files: concept ids or paths; the whole bundle still loads",
	),
);

/** S-31: skips `Provenance.lint`'s git tier for this invocation, without touching `[lint]`. */
const skipProvenanceFlag = Flag.Boolean("skip-provenance").pipe(
	Flag.withDefault(false),
	Flag.withDescription(
		"skip the git-backed lints (generated-at-drift's git tier, resource-ignored, resource-untracked) for this run",
	),
);

/** Spec 4.5: validate one unsaved document, its text read from stdin, in place of the file on disk. */
const documentFlag = Flag.String("document").pipe(
	Flag.optional,
	Flag.withDescription(
		"bundle-relative path of a document whose unsaved text is read from stdin and validated in place of the file on disk",
	),
);

/** R38: the OKF version to read the bundle against; only the one this okfit implements is accepted (R43). */
const targetFlag = Flag.String("target").pipe(
	Flag.optional,
	Flag.withDescription(`report what reads differently under this OKF version (only "${OKF_SPEC_VERSION}")`),
);

const fixFlag = Flag.Boolean("fix").pipe(
	Flag.withDefault(false),
	Flag.withDescription("with --target: declare okf_version and root references that resolve only from the bundle root"),
);

const FIX_KINDS = ["okf-version", "root-relative-path"] as const satisfies ReadonlyArray<MigrationFixKind>;

const onlyFlag = Flag.Literals("only", FIX_KINDS).pipe(
	Flag.atLeast(0),
	Flag.withDescription("with --fix: apply only these fixes (repeatable): okf-version, root-relative-path"),
);

const dryRunFlag = Flag.Boolean("dry-run").pipe(
	Flag.withDefault(false),
	Flag.withDescription("with --fix: say what would change and write nothing"),
);

/** R38/R43: the refusals that are the CLI's to make, in the order they are checked. */
const checkUsage = (input: {
	readonly target: Option.Option<string>;
	readonly fix: boolean;
	readonly only: ReadonlyArray<string>;
	readonly dryRun: boolean;
	readonly document: Option.Option<string>;
}): Effect.Effect<void, ValidateUsageError> => {
	const refuse = (reason: string) => Effect.fail(new ValidateUsageError({ reason }));
	if (Option.isSome(input.target) && input.target.value !== OKF_SPEC_VERSION) {
		return refuse(`--target accepts only "${OKF_SPEC_VERSION}", the OKF version this okfit implements`);
	}
	if (input.fix && Option.isNone(input.target)) return refuse("--fix requires --target");
	if (input.fix && Option.isSome(input.document)) return refuse("--fix cannot be combined with --document");
	if (input.only.length > 0 && !input.fix) return refuse("--only requires --fix");
	if (input.dryRun && !input.fix) return refuse("--dry-run requires --fix");
	return Effect.void;
};

/**
 * `okfit validate [targets...] [--root <dir>] [--config <file>] [--format human|json] [--skip-provenance] [--document <bundle-path>]
 * [--target 0.3 [--fix [--only okf-version|root-relative-path]... [--dry-run]]]`.
 *
 * Handler order fixed by the contract (§2 `src/commands/validate.ts`):
 * stat `--config` (K-1) via `provideConfig`, discover (`OkfitConfigFile.discover`),
 * resolve the profile with the K-4 warning, merge `DEFAULTS < profile < file`
 * (D-28), resolve the project and
 * bundle roots (K-12), run (`@okfit/engine`'s `validate/run.ts#run`), collect and sort the
 * diagnostics, render per `--format` (K-18, K-20 to K-22), and set the exit
 * code without failing the Effect (K-7, K-8).
 *
 * @public
 */
export const validateCommand = Command.make(
	"validate",
	{
		targets: targetsArg,
		root: rootFlag,
		config: configFlag,
		format: formatFlag,
		skipProvenance: skipProvenanceFlag,
		document: documentFlag,
		target: targetFlag,
		fix: fixFlag,
		only: onlyFlag,
		dryRun: dryRunFlag,
	},
	(input) =>
		Effect.gen(function* () {
			const cwd = process.cwd();
			const discoveryCwd = Option.getOrElse(input.root, () => cwd);
			const now = yield* Now;
			const path = yield* Path.Path;
			const distribution = yield* CurrentDistribution;

			const body = Effect.gen(function* () {
				// Inside the wrapped body so a refusal under --format json also prints the K-22 error envelope.
				yield* checkUsage(input);
				const resolved = yield* resolveProjectConfig({
					pathArg: input.root,
					explicitConfigPath: input.config,
					cwd,
				});
				const { bundleRoot, config: merged, profile } = resolved;

				const documents = Option.isSome(input.document)
					? [{ path: input.document.value, text: yield* readDocumentText(input.document.value) }]
					: [];
				const target = Option.getOrUndefined(input.target);
				const runOnce = run({
					root: bundleRoot,
					projectRoot: resolved.projectRoot,
					config: merged,
					profile,
					now,
					...(Option.isSome(resolved.discovered) ? { configPath: resolved.discovered.value.path } : {}),
					skipProvenance: input.skipProvenance,
					// exactOptionalPropertyTypes: omit the key rather than set it to undefined.
					...(target === undefined ? {} : { target }),
				}).pipe(provideDocuments(bundleRoot, documents), Effect.provide(Layer.mergeAll(Git.layer, GitHistory.layer)));
				let result = yield* runOnce;

				// R38: plan and apply, then reload and report what remains. Positional targets narrow the fixes too.
				let fixes: JsonFixes | undefined;
				if (input.fix && target !== undefined) {
					const files =
						input.targets.length === 0
							? undefined
							: (yield* Targets.resolve(input.targets, result.bundle, cwd, { files: true })).map((t) => t.path);
					const plan = yield* applyMigrationFixes({
						bundle: result.bundle,
						config: merged,
						target,
						now,
						dryRun: input.dryRun,
						...(files === undefined ? {} : { files }),
						...(input.only.length === 0 ? {} : { only: input.only }),
					});
					fixes = {
						applied: plan.edits.map((edit) => ({ path: edit.path, fixes: edit.fixes })),
						refused: plan.refused,
						drifts: plan.drifts,
						dry_run: input.dryRun,
					};
					if (!input.dryRun && plan.edits.length > 0) result = yield* runOnce;
				}

				const all = collect(result.report.conformance, result.report.lint, result.profileDiagnostics, result.migration);
				const diagnostics = yield* scopeTo(all, input.targets, result.bundle, cwd);
				const code = forDiagnostics(diagnostics);

				if (input.format === "json") {
					const envelope = json({
						okfitVersion: CLI_VERSION,
						producer: "okfit",
						okfVersion: Option.getOrNull(OkfVersion.declared(result.bundle)),
						root: bundleRoot,
						profile: Option.match(profile, { onNone: () => null, onSome: (p) => p.name }),
						exitCode: code,
						concepts: result.bundle.concepts.size,
						diagnostics,
						// exactOptionalPropertyTypes: omit the key rather than set it to undefined.
						...(target === undefined ? {} : { target }),
						...(fixes === undefined ? {} : { fixes }),
						...(Option.isSome(distribution) ? { distribution: distribution.value } : {}),
					});
					yield* CliFormat.printJson(Schema.encodeSync(JsonEnvelope)(envelope), { indent: 0 });
				} else {
					if (fixes !== undefined) {
						const count = fixes.applied.reduce((sum, edit) => sum + edit.fixes.length, 0);
						yield* Console.log(
							`${fixes.dry_run ? "Would fix" : "Fixed"} ${count} finding(s) in ${fixes.applied.length} file(s)`,
						);
						for (const edit of fixes.applied) {
							// One line per file: each fix kind in first-appearance order, with a count when it repeats (#482).
							const counts = new Map<string, number>();
							for (const kind of edit.fixes) counts.set(kind, (counts.get(kind) ?? 0) + 1);
							const parts = [...counts].map(([kind, n]) => (n > 1 ? `${kind} (${n})` : kind));
							yield* Console.log(`  ${edit.path}: ${parts.join(", ")}`);
						}
						for (const refusal of fixes.refused) yield* Console.log(`refused: ${refusal.file}: ${refusal.reason}`);
						if (fixes.drifts.length > 0) {
							yield* Console.log(`Integrity drifted (re-verify with okfit verify): ${fixes.drifts.join(", ")}`);
						}
					}
					// The summary counts what an un-narrowed --fix would refuse, planned over the final bundle and the same
					// overlay the findings came from (#498). A report never fails because this plan did: it falls back to no refusals.
					const refused =
						target === undefined
							? []
							: Option.match(
									yield* planMigrationFixes({ bundle: result.bundle, config: merged, target, now }).pipe(
										provideDocuments(bundleRoot, documents),
										Effect.option,
									),
									{
										onNone: () => [],
										onSome: (plan) => plan.refused.map(({ file, code }) => ({ file, code })),
									},
								);
					yield* printDiagnostics({
						diagnostics,
						cwd,
						bundleRoot,
						path,
						concepts: result.bundle.concepts.size,
						refused,
						fix: input.fix,
						...(target === undefined ? {} : { target }),
					});
					// #493: a hint, once per run, on stderr; not a finding, so it never changes the exit code.
					if (result.legacyKeys.length > 0) {
						yield* Console.error(
							`hint: ${result.legacyKeys.length} concept(s) still use okfit's old frontmatter key names; run okfit sync to rename them`,
						);
					}
				}

				yield* CliExit.set(code);
			}).pipe(provideConfig({ explicitConfigPath: input.config, discoveryCwd }));

			// K-22: under --format json, an infrastructure failure ALSO gets a stdout
			// envelope, alongside the usual stderr rendering CliRuntime.reportFailures
			// does in bin.ts. tapError re-fails unchanged so that rendering still runs.
			if (input.format === "json") {
				return yield* body.pipe(
					Effect.tapError((error) =>
						CliFormat.printJson(jsonError(error, CLI_VERSION, Option.getOrUndefined(distribution)), { indent: 0 }),
					),
				);
			}
			return yield* body;
		}),
).pipe(Command.withDescription("Load config and bundle, run conformance and lint checks, and render the diagnostics."));
