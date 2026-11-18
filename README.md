# Fig

**Deliciously simple con(fig)s**

Fig manages your dotfiles with small, composable JavaScript or TypeScript configs.
Plugins run in sequence to build your desired config files.

Preview the diff with `fig plan`, then make it so with `fig apply`.

[Docs & setup](docs/README.md) · [Specification](SPEC.md)

## files

Let's say you have your dotfiles in a `~/dev/dotfiles/` directory.

Start by declaring those with `files` in your `fig` config:

```ts
// ~/.config/fig/config.ts
import { plugins } from "fig:plugins";

const { files } = plugins(import.meta.url);

export default [files("~/dev/dotfiles/")];
```

Fig will overwrite the actual files in `~` and with the corresponding files in `~/dev/dotfiles/`.
For example, the contents of `~/dev/dotfiles/.zshrc` get written to `~/.zshrc`.

## json

Many apps use `json` configs, but you might only care about a subset of the fields.
In fact, many apps keep things like `changelog` versions in their configs - which gets very annoying to deal with traditional symlinked dotfiles.

Instead, Fig provides the `json` plugin so you can specify _just_ the settings you care about:

```ts
// ~/.config/fig/config.ts
import { plugins } from "fig:plugins";

const { files, json } = plugins(import.meta.url);

export default [
  files("~/dev/dotfiles/"),
  json("~/.pi/agent/settings.json", (settings) => {
    // Pi has a `lastChangelongVersion` field, but I don't care what it is set to.
    // I just want my theme!
    settings.theme = "rose-pine";
  }),
]
```

All the other settings are preserved.

## text

For complete control, Fig provides the `text` plugin.
Transform the contents of the file any way you want.

```ts
// ~/.config/fig/config.ts
import { plugins } from "fig:plugins";

const { files, json, text } = plugins(import.meta.url);

export default [
  files("./home"),
  json("~/.config/my-app/settings.json", (settings) => {
    settings.theme = "dark";
    settings.fontSize = 14;
  }),
  text("~/.zshrc", (contents) =>
    contents.replace("export EDITOR=nano", "export EDITOR=vim"),
  ),
];
```

## Composing multiple Fig configs

You've got dotfiles for your personal machine, you've got others for work.

As long as each one has a Fig config, you can easily express stuff like "overwrite personal dotfiles with work dotfiles":

```ts
// ~/.config/fig/config.ts
import personal from "~/dev/dotfiles/fig/personal.ts";
import work from "~/dev/work/fig.ts";

export default [...personal, ...work];
```

Your Fig config is code so you can compose other configs however you want!
