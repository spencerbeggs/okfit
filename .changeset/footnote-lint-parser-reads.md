---
"@okfit/core": patch
---

## Bug Fixes

* The `footnote-undefined` lint reads the markdown parser's unresolved footnote markers, so an escaped `\[^x]`, a label that differs only in case from its definition (`[^Foo]` against `[^foo]:`), and an indented or list-item definition no longer warn. These were false positives, and markdownlint MD052 agrees.
* The `footnote-source-unknown` lint reads parsed references and definitions instead of matching text, with identical results on every fixture. An escaped marker is no longer checked.

## Maintenance

* Actor allow-list matching, posix path arithmetic and frontmatter fence detection now use the effected kit's `Wildcard`, `PosixPath` and `FrontmatterSource.split`, with no change in behavior.
