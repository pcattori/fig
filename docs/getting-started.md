# Getting started

[Documentation](README.md) · [Specification](../SPEC.md)

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
