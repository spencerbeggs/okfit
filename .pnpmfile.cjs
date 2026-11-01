// Temporary bridge for the Effect 4.1 upgrade (effected 4.1.1 ledger, step 2.5).
//
// The build toolchain (@savvy-web/silk, @vitest-agent/plugin, pluginfinity, ...)
// still ships on @effected/* releases built against Effect 4.0.7, which import
// the root `Crypto` that Effect 4.1 removed. Under the catalog plugin's
// graph-wide `effect` override they would bind effect@4.1.1 and die at import.
// This hook keeps every published kit package and every toolchain package on
// npm aliases of effect 4.0.7; private workspace packages are left alone.
//
// Remove once every tool okfit builds with has republished on an @effected
// release built on Effect 4.1 (then no lockfile entry names effect@4.0.7).
const BRIDGED = "4.0.7";
const TOOLCHAIN = [
	"@savvy-web/",
	"@okfit/",
	"@tsdoctor/",
	"@vitest-agent/",
	"pluginfinity",
	"@pluginfinity/",
	"rolldown-pnpm-config",
];
const isEffectLine = (name, spec) =>
	(name === "effect" || name.startsWith("@effect/")) && /^[\^~=]*4\./.test(String(spec).trim());
// The new kit (peer `effect: ~4.1.0`) must stay on 4.1.1; only packages whose
// effect edge is on the 4.0 line are bridged by the kit clauses.
const builtOn40 = (pkg) =>
	[pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].some((deps) =>
		/^[\^~=]*4\.0\./.test(String(deps?.effect ?? "").trim()),
	);
const reachesKit = (pkg) =>
	[pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].some((deps) =>
		Object.keys(deps ?? {}).some((name) => name.startsWith("@effected/")),
	);
function readPackage(pkg) {
	if (pkg.private === true || !pkg.name) return pkg;
	const bridged =
		(pkg.version === BRIDGED && isEffectLine(pkg.name, pkg.version)) ||
		TOOLCHAIN.some((p) => pkg.name.startsWith(p)) ||
		((pkg.name.startsWith("@effected/") || reachesKit(pkg)) && builtOn40(pkg));
	if (!bridged) return pkg;
	const pinned = {};
	for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
		for (const name of Object.keys(pkg[field] ?? {})) {
			if (!isEffectLine(name, pkg[field][name])) continue;
			delete pkg[field][name];
			pinned[name] = `npm:${name}@${BRIDGED}`;
		}
	}
	if (Object.keys(pinned).length > 0) pkg.dependencies = { ...pkg.dependencies, ...pinned };
	return pkg;
}
module.exports = { hooks: { readPackage } };
