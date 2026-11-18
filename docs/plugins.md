# Plugins and pipelines

[Documentation](README.md) · [Specification](../SPEC.md)

## API and paths

`fig:plugins` is a host-owned virtual module exposing `plugins`, `Plugin`, and `Transform<T>`; config repositories need not install Fig. Normal npm imports aren't shadowed.

`plugins(import.meta.url)` returns constructors bound to that module's directory. Every plugin captures its declaring URL for errors and ledger provenance. Spreading/re-exporting/reordering plugins never rebases **either** source or destination paths.

- `files(from, to = "~")`: recursively copy/replace source files, including dotfiles and binary files, preserving relative paths and source permissions. Create real directories, not symlinks.
- `json<T>(path, transform)`: parse strict JSON, starting with `{}` for a missing file. Mutate and return nothing, or return a replacement; async supported.
- `text(path, transform)`: receive UTF-8 text, starting with `""` for a missing file; return replacement text; async supported.

All plugin path arguments use the same rules:

- Relative paths resolve against the module passed to `plugins(import.meta.url)`.
- Absolute paths remain absolute; destinations may be outside home.
- A literal first segment `~` expands to OS home: `"~"`, `"~/input"`, `"~/output"`. `"~someone"` and `"./~/output"` remain module-relative names.

For example, `files("./home")` copies to OS home, `files("./config", "./generated")` copies beside the declaring module, and `json("~/settings.json", fn)` reconciles a home file.

Import resolution is separate: `./helper.ts` is relative to the importing module, `~/...` imports resolve from OS home, and package imports use surrounding `node_modules`. Dependencies must be installed explicitly. Jiti transpiles but does not typecheck; its filesystem cache is disabled.

## Pipeline behavior

Start with live contents and run matching plugins in array order. A `files` replacement discards earlier output; later transforms edit that replacement. Compute all output before any destination write.

JSON preserves unknown keys unless your code changes them. Array/merge semantics are ordinary code, not a Fig policy language. Unchanged JSON groups retain original bytes; changed JSON uses two spaces and a trailing newline. JSONC is not supported. Use braces for mutation callbacks so `push()` doesn't accidentally return a replacement number.

**Write deterministic, side-effect-free transforms and idempotent complete pipelines. Fig does not check idempotence or execute callbacks twice to validate it.** Each plugin runs once when planning. Individual transforms needn't be idempotent if an earlier replacement resets their input. JSON is serialized between plugins; don't depend on object identity or non-JSON values.
