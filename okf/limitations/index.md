# Limitation

* [The phase 3 language server does not reload a changed config or clear a dropped session's diagnostics](no-config-reload-in-phase-3.md) - A config change drops a folder's session without revalidating, and a dropped session never clears what it published, so diagnostics go stale until the next document event; Claude Code sends neither notification that triggers the path, so a config edit there needs a session restart.
