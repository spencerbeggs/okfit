---
type: Module
title: Web
description: The web app.
status: stable
---

# Web

A real anchor: [store](store.md#the-v4-sqlite-decision). A duplicate-heading
anchor: [second setup](store.md#setup-1). A bad anchor:
[gone](store.md#no-such-heading). A missing file keeps its own diagnostic:
[missing](missing.md#whatever). A percent-encoded real anchor:
[encoded](./store.md#the-v4-sqlite%2Ddecision). Self-anchors: [good](#web)
and [bad](#no-such-self).

Footnote-shaped literals inside code are text, not references: the label
`[^foo]` and, in a fence,

```md
See [^bar] and define it as [^bar]: like so.
```

A bare reference in prose still counts.[^baz]
