# CLI reference

[Documentation](README.md) · [Specification](../SPEC.md)

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
