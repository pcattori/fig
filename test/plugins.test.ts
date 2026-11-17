import { describe, test } from "vite-plus/test";
import assert from "node:assert/strict";
import { chmod, lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { plugins } from "../src/api.ts";
import { apply } from "../src/engine.ts";
import { fixture } from "./helpers.ts";

describe("Plugin API and paths", () => {
  test.each([
    ["relative", "./nested/file", "module", "nested/file"],
    ["absolute", "ABSOLUTE", "root", "outside-home/file"],
    ["home", "~", "home", ""],
    ["home child", "~/nested/file", "home", "nested/file"],
    ["tilde-prefixed name", "~someone/file", "module", "~someone/file"],
    ["non-leading tilde", "./~/file", "module", "~/file"],
    ["parent directory", "../outside", "root", "outside"],
  ] as const)(
    "resolves %s source/destination arguments against the bound module",
    async (_name, path, base, suffix) => {
      const f = await fixture();
      const input = path === "ABSOLUTE" ? join(f.root, "outside-home/file") : path;
      const expected = join(
        { module: join(f.root, "base"), home: f.home, root: f.root }[base],
        suffix,
      );
      const { files, json, text } = f.api();
      const copy = files(input, input);
      assert.equal(copy.kind, "files");
      if (copy.kind !== "files") throw new Error("Expected files plugin");
      assert.equal(copy.from, expected);
      assert.equal(copy.to, expected);
      for (const plugin of [json(input, () => ({})), text(input, () => "")]) {
        if (plugin.kind === "files") throw new Error("Expected transform plugin");
        assert.equal(plugin.path, expected);
      }
    },
  );

  test("binding captures both paths and provenance even after spreading/reordering", async () => {
    const f = await fixture();
    const base = [f.api("base").files("./input", "./output")];
    const work = [f.api("work").text("./output", () => "work")];
    const combined = [...work, ...base];
    const copy = combined[1];
    if (copy.kind !== "files") throw new Error("Expected files plugin");
    assert.equal(copy.source, f.module("base").href);
    assert.equal(copy.from, join(f.root, "base/input"));
    assert.equal(copy.to, join(f.root, "base/output"));
    const transform = combined[0];
    if (transform.kind === "files") throw new Error("Expected transform plugin");
    assert.equal(transform.path, join(f.root, "work/output"));
    assert.equal(transform.source, f.module("work").href);
  });

  test("files defaults to home and recursively copies structure, dotfiles, bytes, and source permissions", async () => {
    const f = await fixture();
    await f.file(join(f.root, "base/input/.config/tool/settings"), "settings");
    await f.file(join(f.root, "base/input/bin/tool"), "#!/bin/sh\necho ok\n");
    await chmod(join(f.root, "base/input/bin/tool"), 0o755);
    const bytes = Buffer.from([0, 255, 3]);
    await f.file(join(f.root, "base/input/image"), bytes);
    const config = [f.api().files("./input")];
    if (config[0].kind !== "files") throw new Error("Expected files plugin");
    assert.equal(config[0].to, f.home);
    await apply(await f.plan(config));
    assert.equal(await readFile(join(f.home, ".config/tool/settings"), "utf8"), "settings");
    assert.deepEqual(await readFile(join(f.home, "image")), bytes);
    assert.equal((await lstat(join(f.home, "bin/tool"))).mode & 0o777, 0o755);
    assert.ok((await lstat(join(f.home, ".config/tool"))).isDirectory());
    assert.ok((await lstat(join(f.home, "image"))).isFile());
    assert.equal((await f.plan(config)).changes.length, 0);
  });

  test("constructors require a file module URL and handle URL-encoded path names", async () => {
    const f = await fixture();
    assert.throws(() => plugins("https://example.com/config.ts"), /file module URL/);
    const url = pathToFileURL(join(f.root, "with spaces/config.ts"));
    const plugin = plugins(url.href).files("./input", "./output");
    if (plugin.kind !== "files") throw new Error("Expected files plugin");
    assert.equal(plugin.source, url.href);
    assert.equal(plugin.from, join(f.root, "with spaces/input"));
    assert.equal(plugin.to, join(f.root, "with spaces/output"));
  });
});
