# Limitation

* [Two narrow interrupt windows in the LSP session registry are documented, not closed](lsp-registry-interrupt-windows.md) - An interrupt landing in one of two narrow windows inside the session registry's rebuild and folder-build paths either skips a session's dispose or leaks its scope; both windows need a fiber interrupted at a point only shutdown or transport scope close can reach, and phase 4's final review accepted them as documented edges rather than fixed.
