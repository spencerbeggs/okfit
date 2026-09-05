#!/usr/bin/env bash
# Vendors the four OKF v0.2 sample bundles from GoogleCloudPlatform/knowledge-catalog
# at one pinned commit into this directory (decision D-38). Idempotent: bundle
# directories are removed and re-fetched. Omits the generated viz.html viewers.
set -euo pipefail

COMMIT="fbbc7975388288244dfc62aea0066600b25b7c47"
REPO="GoogleCloudPlatform/knowledge-catalog"
RAW="https://raw.githubusercontent.com/${REPO}/${COMMIT}/okf"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# File list from the git tree at the pinned commit; paths relative to okf/bundles/.
FILES="$(curl -fsSL "https://api.github.com/repos/${REPO}/git/trees/${COMMIT}?recursive=1" | node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; }).on("end", () => {
	const tree = JSON.parse(raw);
	if (tree.truncated) { console.error("tree listing truncated"); process.exit(1); }
	for (const { type, path } of tree.tree) {
		if (type === "blob" && path.startsWith("okf/bundles/") && !path.endsWith("/viz.html")) console.log(path.slice(12));
	}
});
')"

for bundle in acme_retail crypto_bitcoin ga4 stackoverflow; do
	rm -rf "${DEST:?}/${bundle}"
done

count=0
while IFS= read -r relative; do
	mkdir -p "${DEST}/$(dirname "${relative}")"
	curl -fsSL "${RAW}/bundles/${relative}" -o "${DEST}/${relative}"
	count=$((count + 1))
done <<<"${FILES}"

curl -fsSL "${RAW}/LICENSE.md" -o "${DEST}/LICENSE.md"
echo "vendored ${count} bundle files + LICENSE.md into ${DEST}"
