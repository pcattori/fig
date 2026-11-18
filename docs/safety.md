# State, cleanup, and safety

[Documentation](README.md) · [Specification](../SPEC.md)

## Ledger and cleanup

One fixed ledger at OS-home `.local/state/fig/state.json` tracks all configs and destinations, including paths outside home. Switching configs is not a separate deployment: obsolete resources are considered for cleanup.

- Pipelines containing `files` own the whole destination. Delete obsolete files only if contents and permissions still match the ledger; preserve modified ones and retain their history.
- Preserve and relinquish obsolete transform-only files: they can contain application-owned settings. Removing a transform doesn't reverse its edits.
- Forget missing obsolete files; leave empty directories. A missing ledger never authorizes speculative cleanup.

## Safety and limits

Configs are trusted executable code with your permissions, not sandboxed plugins. Side-effect-free planning is the engine's behavior; user code can violate it.

Fig rejects source symlinks, symlink destinations/ancestors, file/directory collisions, and ledger-path overlaps. It locks concurrent applies and preflights changed files/ledger contents. Individual writes are atomic. Transform-only files preserve existing permissions; newly created files default to `0600`.

Apply is not a multi-file transaction. A crash/I/O failure can leave partial application, and applications can still race writes. There is no backup, rollback, legacy-symlink migration, repository fetching, tool installation, editor setup, or capture workflow in v1. A crash can leave a `.lock`; remove it only after confirming no apply is running.
