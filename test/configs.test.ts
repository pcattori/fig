import { describe, test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadPlugins } from "../src/loader.ts";
import { absent, fixture } from "./helpers.ts";

describe("Configs and imports", () => {
  test.each([
    ["plan", "default"],
    ["apply", "default"],
    ["plan", "-c"],
    ["apply", "-c"],
    ["plan", "--config"],
    ["apply", "--config"],
  ] as const)(
    "loads OS-home config unless -c/--config overrides it (%s, %s)",
    async (command, flag) => {
      const f = await fixture();
      const module = (value: string) => `
      import {plugins} from 'fig:plugins';
      const {text} = plugins(import.meta.url);
      export default [text('~/chosen', () => '${value}\\n')];
    `;
      await f.file(join(f.home, ".config/fig/config.ts"), module("default"));
      await f.file(join(f.root, "override.ts"), module("override"));
      const overridden = flag !== "default";
      const result = f.run([command, ...(overridden ? [flag, "override.ts"] : [])]);
      assert.equal(result.status, 0, result.stderr);
      const expected = overridden ? "override" : "default";
      if (command === "apply")
        assert.equal(await readFile(join(f.home, "chosen"), "utf8"), `${expected}\n`);
      else {
        assert.ok(result.stdout.includes(`+${expected}\n`));
        await absent(join(f.home, "chosen"));
        await absent(f.ledger);
      }
    },
  );

  test("ES modules compose flat arrays across repositories without compilation or rebasing", async () => {
    const f = await fixture();
    await f.file(
      join(f.root, "machine/config.ts"),
      `
      import base from '../public/base.mjs';
      import work from '../private/work.mts';
      export default [...base, ...work];
    `,
    );
    await f.file(join(f.root, "public/files/settings.json"), '{"theme":"base"}');
    await f.file(
      join(f.root, "public/base.mjs"),
      `
      import {plugins} from 'fig:plugins';
      const {files} = plugins(import.meta.url);
      export default [files('./files', './generated')];
    `,
    );
    await f.file(join(f.root, "private/helper.ts"), `export enum Theme { Work = 'work' }`);
    // Also proves the host's virtual module doesn't shadow a real npm package.
    await f.dependency(join(f.root, "private"), "@local/fig", "module.exports = {suffix:'-npm'};");
    await f.file(
      join(f.root, "private/work.mts"),
      `
      import {plugins} from 'fig:plugins';
      import {Theme} from './helper';
      import {suffix} from '@local/fig';
      const {json} = plugins(import.meta.url);
      export default [json('../public/generated/settings.json', config => {config.theme = Theme.Work + suffix})];
    `,
    );
    const result = f.run(["apply", "-c", join(f.root, "machine/config.ts")], {
      cwd: "/",
      nodeArgs: ["--no-experimental-strip-types"],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(await readFile(join(f.root, "public/generated/settings.json"), "utf8")),
      { theme: "work-npm" },
    );
    await absent(join(f.root, "private/node_modules/.cache"));
  });

  test.each([
    ["wrapper object", "export default {plugins:[]}", /default export must be a Plugin\[\] array/],
    ["nested array", "export default [[]]", /invalid plugin at index 0/],
    ["null entry", "export default [null]", /invalid plugin at index 0/],
    ["sparse array", "export default [,]", /invalid plugin at index 0/],
    [
      "unbound plugin",
      "export default [{kind:'text',path:'x',transform:()=>''}]",
      /invalid plugin at index 0/,
    ],
    [
      "missing import",
      "import missing from './missing.ts'; export default [...missing]",
      /missing/,
    ],
  ] as const)("rejects %s before applying anything", async (_name, code, error) => {
    const f = await fixture();
    await f.file(join(f.root, "config.ts"), code);
    await assert.rejects(loadPlugins(join(f.root, "config.ts")), error);
    await absent(f.home);
  });

  test.each(["cjs", "cts"])(
    "CommonJS .%s config entrypoints are unsupported",
    async (extension) => {
      const f = await fixture();
      const path = join(f.root, `config.${extension}`);
      await f.file(path, "module.exports = []");
      await assert.rejects(loadPlugins(path), /ES modules/);
    },
  );

  test("relative imports use their module; ~/ imports use OS home without rewriting other tilde names", async () => {
    const f = await fixture();
    await f.file(join(f.home, ".fig/helper.ts"), "export default 'home';");
    await f.dependency(join(f.root, "work"), "~helpers", "module.exports = {suffix:'-package'};");
    await f.file(
      join(f.root, "work/config.js"),
      `
      import {plugins} from 'fig:plugins';
      import value from '~/.fig/helper.ts';
      import {suffix} from '~helpers';
      const {text} = plugins(import.meta.url);
      export default [text('~/result', () => value + suffix)];
    `,
    );
    await f.file(
      join(f.root, "config.ts"),
      "import work from './work/config.js'; export default [...work];",
    );
    const result = f.run(["apply", "-c", "config.ts"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(f.home, "result"), "utf8"), "home-package");
  });

  test("a missing default config fails without creating home", async () => {
    const f = await fixture();
    const result = f.run(["plan"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.config\/fig\/config.ts/);
    await absent(f.home);
  });
});
