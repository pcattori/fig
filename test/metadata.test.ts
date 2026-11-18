import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { chmod, lstat, readFile, readlink, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { apply } from "../src/engine.ts";
import { render } from "../src/display.ts";
import { absent, fixture } from "./helpers.ts";

test("files dereferences source links and replaces destination links without touching referents", async () => {
  const f = await fixture();
  const source = join(f.root, "input");
  const original = join(f.root, "original");
  await f.file(join(source, "regular"), "new\n");
  await chmod(join(source, "regular"), 0o640);
  await symlink("regular", join(source, "linked"));
  await symlink(source, join(f.root, "source-link"));
  await f.file(original, "untouched\n");
  await f.file(join(f.home, "placeholder"), "");
  await symlink(original, join(f.home, "linked"));
  const config = [f.api().files("../source-link")];
  const result = await f.plan(config);
  assert.match(render(result, "plan"), /type: symlink → file/);
  assert.match(render(result, "plan"), /mode: 777 → 640/);
  assert.equal((await lstat(join(f.home, "linked"))).isSymbolicLink(), true);
  await apply(result);
  assert.equal((await lstat(join(f.home, "linked"))).isFile(), true);
  assert.equal(await readFile(join(f.home, "linked"), "utf8"), "new\n");
  assert.equal(await readFile(original, "utf8"), "untouched\n");
  assert.equal((await f.plan(config)).changes.length, 0);
});

test("metadata composes in pipeline order, supports mode-only edits and symlink creation", async () => {
  const f = await fixture();
  const path = join(f.home, "entry");
  const { text, json } = f.api();
  await apply(
    await f.plan([
      text("~/entry", (_, metadata) => {
        metadata.mode = 0o640;
        return "original";
      }),
    ]),
  );
  const modeOnly = await f.plan([
    text("~/entry", (contents, metadata) => {
      metadata.mode = 0o600;
      return contents;
    }),
  ]);
  assert.match(render(modeOnly, "plan"), /MODE.*mode: 640 → 600/);
  await apply(modeOnly);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  const config = [
    text("~/entry", (_, metadata) => {
      metadata.type = "symlink";
      metadata.mode = 0o777;
      return "missing-target";
    }),
    text("~/entry", (target, { type, mode }) => {
      assert.equal(type, "symlink");
      assert.equal(mode, 0o777);
      return target;
    }),
  ];
  await apply(await f.plan(config));
  assert.equal(await readlink(path), "missing-target");
  assert.equal((await f.plan(config)).changes.length, 0);
  await assert.rejects(f.plan([json("~/entry", () => {})]), /require a regular file/);
  await apply(
    await f.plan([
      text("~/entry", (_, metadata) => {
        metadata.type = "file";
        metadata.mode = 0o600;
        return "restored";
      }),
    ]),
  );
  assert.equal(await readFile(path, "utf8"), "restored");
});

test("type changes after planning fail preflight even if payload and mode match", async () => {
  const f = await fixture();
  const path = join(f.home, "entry");
  await f.file(path, "target");
  await chmod(path, 0o777);
  const result = await f.plan([f.api().text("~/entry", () => "new")]);
  await unlink(path);
  await symlink("target", path);
  await assert.rejects(apply(result), /changed since planning/);
  assert.equal(await readlink(path), "target");
});

test("cleanup preserves resources whose type changed", async () => {
  const f = await fixture();
  await f.file(join(f.root, "input/entry"), "target");
  await chmod(join(f.root, "input/entry"), 0o777);
  await apply(await f.plan([f.api().files("../input")]));
  await unlink(join(f.home, "entry"));
  await symlink("target", join(f.home, "entry"));
  const result = await f.plan([]);
  assert.equal(result.changes[0].action, "preserve");
  await apply(result);
  assert.equal(await readlink(join(f.home, "entry")), "target");
});

test("source directory cycles and dangling source links fail without writes", async () => {
  const f = await fixture();
  await f.file(join(f.root, "input/file"), "contents");
  await symlink(".", join(f.root, "input/cycle"));
  await assert.rejects(f.plan([f.api().files("../input")]), /cycle/);
  await unlink(join(f.root, "input/cycle"));
  await symlink("missing", join(f.root, "input/dangling"));
  await assert.rejects(f.plan([f.api().files("../input")]), { code: "ENOENT" });
  await absent(f.home);
});

test("JSON callbacks can change permissions without reformatting contents", async () => {
  const f = await fixture();
  const path = join(f.home, "settings.json");
  await f.file(path, '{"enabled":true}');
  const config = [
    f.api().json("~/settings.json", (_, metadata) => {
      metadata.mode = 0o600;
    }),
  ];
  await apply(await f.plan(config));
  assert.equal(await readFile(path, "utf8"), '{"enabled":true}');
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.equal((await f.plan(config)).changes.length, 0);
});

test("whole-owned symlinks can be created and safely cleaned up", async () => {
  const f = await fixture();
  await f.file(join(f.root, "input/entry"), "contents");
  const config = [
    f.api().files("../input"),
    f.api().text("~/entry", (_, metadata) => {
      metadata.type = "symlink";
      metadata.mode = 0o777;
      return "missing";
    }),
  ];
  await apply(await f.plan(config));
  assert.equal((await f.plan(config)).changes.length, 0);
  const cleanup = await f.plan([]);
  assert.equal(cleanup.changes[0].action, "delete");
  await apply(cleanup);
  await absent(join(f.home, "entry"));
});

test.each(["", "bad\0target"])("rejects invalid symlink target %s", async (target) => {
  const f = await fixture();
  await assert.rejects(
    f.plan([
      f.api().text("~/entry", (_, metadata) => {
        metadata.type = "symlink";
        metadata.mode = 0o777;
        return target;
      }),
    ]),
    /Invalid symlink target/,
  );
  await absent(f.home);
});

test("rejects unportable symlink modes", async () => {
  const f = await fixture();
  await assert.rejects(
    f.plan([
      f.api().text("~/entry", (_, metadata) => {
        metadata.type = "symlink";
        metadata.mode = 0o600;
        return "target";
      }),
    ]),
    /Symlink mode must be 777/,
  );
  await absent(f.home);
});

test.each([-1, 0o1000, 1.5, NaN])("rejects invalid mode %s", async (mode) => {
  const f = await fixture();
  await assert.rejects(
    f.plan([
      f.api().text("~/entry", (_, metadata) => {
        metadata.mode = mode;
        return "contents";
      }),
    ]),
    /Invalid file mode/,
  );
  await absent(f.home);
});
