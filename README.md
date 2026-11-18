# Fig

Dotfiles as ordered plugin arrays: live file → replacements/transforms → proposed file. See [SPEC.md](SPEC.md) for v1 rules.

## Try safely

```sh
cd ~/dev/fig
pnpm install
pnpm exec vp run build
NODE="$(node -p 'process.execPath')"
HOME="$PWD/.sandbox/home" "$NODE" dist/cli.mjs plan -c examples/config.ts
HOME="$PWD/.sandbox/home" "$NODE" dist/cli.mjs apply -c examples/config.ts
HOME="$PWD/.sandbox/home" "$NODE" dist/cli.mjs plan -c examples/config.ts
```

These commands give the child process an isolated OS-home environment; they do not modify your actual home. The final plan should show zero changed files. Fig has no configurable home or ledger flags.

After building, `pnpm link --global` makes the `fig` bin available. For distribution, build then `pnpm pack`. Users need Node and the package's runtime dependencies, not the development toolchain or a config compilation step.

## Configs

By default Fig loads OS-home `.config/fig/config.ts`. Configs are JS/TS **ES modules** exporting a flat `Plugin[]`:

```ts
import { plugins } from "fig:plugins";

const { files, json, text } = plugins(import.meta.url);

export default [
  files("./home"),
  json("~/.example/settings.json", (config) => {
    config.theme = "dark";
  }),
  text("./local-message", (contents) => contents.replace("old", "new")),
];
```

Composition is ordinary JavaScript, including across repositories:

```ts
import base from "~/dev/dotfiles/base.ts";
import work from "~/work/internal-dotfiles/work.ts";

export default [...base, ...work];
```

No formal profiles, wrappers, inheritance, directory discovery, or automatic flattening. Invalid exports/plugins and missing imports fail before applying. CommonJS config entrypoints (`.cjs`/`.cts`) are unsupported; ordinary third-party CommonJS packages can still be imported as dependencies.

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

## Commands and output

```sh
fig plan
fig apply
fig plan --config ./other.ts
fig apply -c ./other.ts
```

Only config/help flags are supported. Relative CLI config paths resolve from the working directory; literal `~/` expands from OS home. Positional config paths are rejected.

`plan` shows built-in unified diffs plus operation summaries, without writing destinations or the ledger. It uses jsdiff, not Git or a system `diff` executable. Diffs compare exact file contents, including JSON formatting. **Diffs may expose secrets.**

`apply` recomputes the current plan, writes it, then shows compact per-file added/removed line counts and totals. Binary changes, permission changes, and preserved obsolete files get their own notices. No full diffs during apply and no pager, external viewer, diff flag, or verbosity mode in v1. Extremely expensive diffs have a computation limit and explicitly report unavailable line counts rather than blocking indefinitely.

## Ledger and cleanup

One fixed ledger at OS-home `.local/state/fig/state.json` tracks all configs and destinations, including paths outside home. Switching configs is not a separate deployment: obsolete resources are considered for cleanup.

- Pipelines containing `files` own the whole destination. Delete obsolete files only if contents and permissions still match the ledger; preserve modified ones and retain their history.
- Preserve and relinquish obsolete transform-only files: they can contain application-owned settings. Removing a transform doesn't reverse its edits.
- Forget missing obsolete files; leave empty directories. A missing ledger never authorizes speculative cleanup.

## Safety and limits

Configs are trusted executable code with your permissions, not sandboxed plugins. Side-effect-free planning is the engine's behavior; user code can violate it.

Fig rejects source symlinks, symlink destinations/ancestors, file/directory collisions, and ledger-path overlaps. It locks concurrent applies and preflights changed files/ledger contents. Individual writes are atomic. Transform-only files preserve existing permissions; newly created files default to `0600`.

Apply is not a multi-file transaction. A crash/I/O failure can leave partial application, and applications can still race writes. There is no backup, rollback, legacy-symlink migration, repository fetching, tool installation, editor setup, or capture workflow in v1. A crash can leave a `.lock`; remove it only after confirming no apply is running.

## Internals

`engine.ts` is the imperative shell: it reads files, captures destination snapshots, runs user callbacks once, and performs locked/atomic writes. `reconcile.ts` contains the pure `reconcile(desired, current, previousLedger)` function, which decides writes, unchanged files, cleanup, and the next ledger using values alone.

All destination inputs are captured before callbacks run. Callbacks remain an arbitrary-code boundary, not a claim of purity. Policy tests use ordinary maps and buffers; filesystem safety and CLI tests still use real temporary directories. No filesystem framework or dependency-injection layer is involved.

## Development

Node LTS and exact pnpm versions are specified in `package.json`. Vite+ handles builds, tests, typechecking tasks, linting, and formatting:

```sh
pnpm exec vp run test
pnpm exec vp run typecheck
pnpm exec vp lint
pnpm exec vp fmt
```

Test suites mirror the executable capability headings in SPEC.md: configs/imports, plugin API/paths, transform execution, planning/applying, ledger/cleanup, and safety. Each test names a rule; `test.each` supplies examples. Shared fixtures isolate OS home and CLI execution. Detailed assertions live at the lowest useful layer, with focused CLI integration coverage. Unique regressions for older ledgers and safe path display are retained. No test deploys to your actual home.
