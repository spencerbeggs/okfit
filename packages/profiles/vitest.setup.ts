// P-57 (decision 57, amends P-34): hermeticity extends to the system under test, not just the fixture
// builder. `GitHistory.layer` and `@effected/git`'s `Git.layer` spawn real git in the integration suites
// (__test__/integration/*.int.test.ts); this runs before any of them can spawn, so neither ever reads the
// host's ~/.gitconfig or a machine-wide system config. Auto-picked up as this package's Vitest project
// setupFiles by @vitest-agent/plugin's DefaultDiscoverStrategy (a package-root `vitest.setup.ts`).
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
