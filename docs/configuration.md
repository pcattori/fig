# Configuration

[Documentation](README.md) · [Specification](../SPEC.md)

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
