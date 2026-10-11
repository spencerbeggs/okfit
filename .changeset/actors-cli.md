---
"@okfit/cli": patch
---

## Features

* Trust signals honour the [actors].humans allow-list
* okfit verify, --revoke and the picker refuse a human that a non-empty [actors].humans does not list (HumanActorNotAllowedError, exit 3), and honour git config okfit.actor
