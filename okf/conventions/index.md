# Convention

* [Commits are conventional, DCO signed, never on main](commits-conventional-dco-no-main.md) - Every commit uses a conventional-commit subject, carries a DCO sign-off trailer, and never lands directly on main.
* [Effect v4 pinned to catalog:effect](effect-v4-pinned-version.md) - Every okfit package uses Effect v4 at the version pinned in catalog:effect; node_modules wins over the vendored source on disagreement.
* [Never flip private in a source package.json](build-never-flip-private-in-source.md) - @savvy-web/bundler flips "private" on publish; a source package.json never sets "private": false itself, and no changeset is written before the initial release.
* [No process.cwd() or environment reads in profiles](no-process-cwd-or-env-reads-in-profiles.md) - @okfit/profiles never calls process.cwd() or reads an environment variable; writer and cwd are always explicit arguments.
* [Relative imports use .js extensions](relative-imports-js-extension.md) - Relative imports end in .js; built-ins use the node: prefix; type-only imports are separate import type statements.
* [Tests live in __test__/, never in src/](tests-live-in-test-dir.md) - Every package's tests sit under __test__/; nothing under src/ is a test file.
* [process reads confined to the CLI's boundary files](process-reads-confined-in-cli.md) - Only bin.ts, commands/*.ts, internal/exit.ts, and internal/tty.ts read process; every other file under packages/cli/src is pure or Effect-typed.
