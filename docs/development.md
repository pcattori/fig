# Development

[Documentation](README.md) · [Specification](../SPEC.md)

## Development

Node and exact pnpm versions are specified in `package.json`. Vite+ handles builds, tests, typechecking tasks, linting, and formatting:

```sh
pnpm exec vp run test
pnpm exec vp run typecheck
pnpm exec vp lint
pnpm exec vp fmt
```

GitHub Actions runs formatting checks (`pnpm exec vp fmt --check`), lint, typechecking, and tests on pull requests and pushes to `main`. Typechecking and test tasks build the package first.

Test suites mirror the executable capability headings in [SPEC.md](../SPEC.md): configs/imports, plugin API/paths, transform execution, planning/applying, ledger/cleanup, and safety. Each test names a rule; `test.each` supplies examples. Shared fixtures isolate OS home and CLI execution. Detailed assertions live at the lowest useful layer, with focused CLI integration coverage. Unique regressions for older ledgers and safe path display are retained. No test deploys to your actual home.

## Internals

`engine.ts` is the imperative shell: it reads files, captures destination snapshots, runs user callbacks once, and performs locked/atomic writes. `reconcile.ts` contains the pure `reconcile(desired, current, previousLedger)` function, which decides writes, unchanged files, cleanup, and the next ledger using values alone.

All destination inputs are captured before callbacks run. Callbacks remain an arbitrary-code boundary, not a claim of purity. Policy tests use ordinary maps and buffers; filesystem safety and CLI tests still use real temporary directories. No filesystem framework or dependency-injection layer is involved.
