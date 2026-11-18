## Configs and imports

- **Load the default config unless explicitly overridden.**

  `fig plan` and `fig apply` load OS-home `.config/fig/config.ts`. Override with `--config <file>` or `-c <file>`, never a positional path.

- **Configs are ES modules exporting flat plugin arrays.**

  Load JS/TS through Jiti. Configs export `Plugin[]` and compose using ordinary imports and spreads, including across repositories.

- **Keep configuration flat and explicit.**

  No profiles, config wrappers, inheritance, directory discovery, or implicit array flattening. Reject invalid exports/plugins and missing imports before applying.

- **Resolve imports according to their form.**

  Relative imports resolve against the importing module; `~/` imports mean OS home. Third-party dependencies must be explicitly installed.

## Plugin API and paths

- **Provide the API through `fig:plugins`.**

  Expose `plugins`, `Plugin`, and `Transform<T>` through this virtual module without shadowing npm packages.

- **Bind plugins to their declaring module.**

  `plugins(import.meta.url)` binds constructors and provenance to that module. Composition never rebases source or destination paths.

- **Copy directory trees with `files`.**

  `files(from, to = "~")` recursively copies/replaces files, including dotfiles and binary files, preserving relative paths and source permissions. Dereference source symlinks, including directory links; reject dangling links and directory cycles.

- **Resolve plugin paths consistently.**

  Relative source and destination paths resolve against the bound module. Absolute paths remain absolute; a literal leading `~` segment means OS home. Home is not configurable, and destinations may be outside it.

- **Support structured and text transforms.**

  `json<T>(path, transform)` accepts mutation or a returned replacement. `text(path, transform)` requires returned UTF-8 text. Both support async callbacks and receive mutable `{ type, mode }` metadata as a second argument. Type is `file` or `symlink`; mode is an integer from `0o000` to `0o777`. Symlinks require mode `0o777`; their contents represent the link target string. JSON input must be a regular file. Existing one-argument callbacks remain valid.

## Transform execution

- **Compute ordered pipelines before writing.**

  Start each destination pipeline with its live contents, run matching plugins in array order, and compute all results before writing.

- **Replacements discard preceding output.**

  `files` replaces preceding output, resets type to regular file, and sets source referent permissions. Subsequent transforms modify that replacement; subsequent replacements discard earlier work.

- **Preserve content outside user-directed changes.**

  Missing JSON starts as `{}`; missing text starts as `""`. Preserve unmanaged JSON fields unless user code changes them. Array/merge behavior is ordinary user code.

- **Use strict JSON with predictable formatting.**

  Preserve unchanged JSON bytes. Format changed JSON with two spaces and a trailing newline.

- **Make repeatability the user's responsibility.**

  Document deterministic, side-effect-free callbacks and whole-pipeline idempotence as user responsibilities. Do not double-execute pipelines to check idempotence.

## Planning and applying

- **Show built-in unified diffs when planning.**

  Use jsdiff's `diff` package against exact contents, without requiring Git or system `diff`. When replacing a destination symlink with a regular file, compare its planning-time dereferenced contents against the new contents. Report unavailable contents rather than an empty-file diff for dangling, unreadable, or non-file referents. Other symlink diffs compare link target strings. Dereferencing is display-only: ownership and preflight snapshots still capture the link target, and writes never follow destination symlinks.

- **Render plans as filename-first blocks with compact metadata.**

  Separate file blocks with blank lines. Show a bold path, then any metadata changes on their own indented line, then indented unified diff hunks. Omit unified diff file headers; retain `@@` hunk headers. Represent metadata as space-separated before/after tokens, such as `-symlink +file:600` or `-file:644 +file:600`. Include modes on regular files, not symlinks; do not count a type replacement as a permission change. Creation shows only the added token; deletion only the removed token. Preserved files get a notice instead of a diff.

  Use red for removals, green for additions, blue for hunk headers, and dim text for context, notices, and totals. Enable color only on supported terminals and respect `NO_COLOR`; plain output retains the same text and spacing. Summarize changed files and content line counts, explicitly noting unchanged or unavailable contents when appropriate. Omit zero-valued permission, preserved, and unchanged counters. Apply output remains compact as described below.

- **Planning does not write managed files.**

  Do not write destinations or the ledger. Report creation/deletion, type changes, permissions, binary changes, and preserved obsolete files alongside content diffs.

- **Show compact summaries when applying.**

  `apply` computes and applies the current plan. Show per-file added/removed line counts and totals, not full diffs.

- **Report changes and errors appropriately.**

  Use binary markers instead of line counts. Show permission changes and preserved-file notices. Include declaring-module provenance in errors.

- **Keep command output fixed in v1.**

  No external diff viewers, pagers, diff flags, or verbosity options.

## Ledger and cleanup

- **Share one fixed ledger across configs.**

  Store it at OS-home `.local/state/fig/state.json`, with no ledger override.

- **Record ownership and last-applied state.**

  Track destinations, hashes (symlink hashes cover target strings), types, permissions, declaring modules, and whole-file ownership from `files` plugins.

- **Delete obsolete whole-file-owned files conservatively.**

  Delete only when contents, type, and permissions still match the ledger. Treat older ledger entries without type as regular files. Preserve modified files and retain their ownership history.

- **Preserve obsolete transform-only files.**

  Relinquish their ownership. Removing transforms neither reverses their edits nor deletes application-owned settings.

- **Do not infer ownership during cleanup.**

  Forget missing obsolete files and keep empty directories. Never infer cleanup ownership when the ledger is missing.

## Safety

- **Reject unsafe filesystem relationships.**

  Reject symlink destination ancestors, file/directory collisions, and ledger-path overlaps. Capture destination leaf symlinks without following them and allow atomic replacement of the leaf. Never follow destination symlinks when writing. Ledger paths and ancestors must not be symlinks.

- **Protect applies against concurrent changes.**

  Lock concurrent applies, preflight affected files and ledger contents, and refuse to overwrite changes made since planning.

- **Replace files atomically and preserve permissions.**

  Atomically replace individual files and the ledger. Preserve existing transform-only permissions and default new files to `0600`.

- **Treat configs as trusted executable code.**

  Configs execute with user permissions, not in a sandbox. Engine guarantees cannot prevent user-code side effects, and applications can still race an apply.

## Scope

- **Require no config-side build or editor setup.**

  Configs need no compilation, generated project files, or editor integration to run.

- **Keep v1 focused on file reconciliation.**

  Repository fetching, tool installation, editor setup, capture, external diff integration, backups, rollback, and multi-file transactions are outside v1.
