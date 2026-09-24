#!/usr/bin/env bash
# Usage: assert-version.sh <tag> <package.json>
# Exits 0 when <tag> is @okfit/vscode-extension@<version> and <version> equals the manifest's version.
set -euo pipefail
tag="${1:?tag required}"
manifest="${2:?package.json path required}"
prefix="@okfit/vscode-extension@"
case "$tag" in
  "$prefix"*) ;;
  *) echo "tag $tag does not start with $prefix" >&2; exit 2 ;;
esac
want="${tag#"$prefix"}"
have="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).version)' "$manifest")"
if [ "$want" != "$have" ]; then
  echo "tag version $want does not match manifest version $have" >&2
  exit 1
fi
echo "version $have matches tag"
