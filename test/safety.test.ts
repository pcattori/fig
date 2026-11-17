import { describe, test } from "vite-plus/test";
import assert from "node:assert/strict";
import { chmod, lstat, open, readFile, readdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { apply } from "../src/engine.ts";
import type { Plugin } from "../src/api.ts";
import { absent, fixture } from "./helpers.ts";

describe("Safety", () => {
  test.each(["source root", "source entry", "destination", "destination ancestor"] as const)(
    "rejects a symlink at the %s",
    async (example) => {
      const f = await fixture();
      const original = join(f.root, "original/file");
      await f.file(original, "do not touch");
      let config: Plugin[];
      if (example === "source root") {
        await symlink(dirname(original), join(f.root, "linked"));
        config = [f.api().files("../linked")];
      } else if (example === "source entry") {
        await f.file(join(f.root, "input/regular"), "regular");
        await symlink(original, join(f.root, "input/linked"));
        config = [f.api().files("../input")];
      } else if (example === "destination") {
        await symlink(original, join(f.root, "linked"));
        config = [f.api().text("../linked", () => "overwrite")];
      } else {
        await symlink(dirname(original), join(f.root, "linked"));
        config = [f.api().text("../linked/file", () => "overwrite")];
      }
      await assert.rejects(f.plan(config), /symlink|Unsupported files source/);
      assert.equal(await readFile(original, "utf8"), "do not touch");
      await absent(f.ledger);
    },
  );

  test.each([
    ["file/directory collision", ["~/a", "~/a/b"], /File\/directory conflict/],
    ["ledger itself", ["~/.local/state/fig/state.json"], /overlaps ledger/],
    ["ledger ancestor", ["~/.local/state"], /overlaps ledger/],
    ["ledger descendant", ["~/.local/state/fig/state.json/child"], /overlaps ledger/],
    ["ledger lock", ["~/.local/state/fig/state.json.lock"], /overlaps ledger/],
  ] as const)("rejects %s before writing", async (_name, paths, error) => {
    const f = await fixture();
    await assert.rejects(f.plan(paths.map((path) => f.api().text(path, () => "new"))), error);
    await absent(f.home);
  });

  test.each(["contents", "permissions", "ledger"] as const)(
    "preflights all changes before writing when %s changed since planning",
    async (example) => {
      const f = await fixture();
      const target = join(f.home, "z-target");
      const other = join(f.home, "a-other");
      await f.file(target, "original");
      await chmod(target, 0o644);
      await f.file(other, "other original");
      const result = await f.plan([
        f.api().text("~/a-other", () => "new"),
        f.api().text("~/z-target", () => "new"),
      ]);
      if (example === "contents") await f.file(target, "user edit");
      if (example === "permissions") await chmod(target, 0o600);
      if (example === "ledger") await f.file(f.ledger, '{"version":1,"files":{}}');
      await assert.rejects(apply(result), /changed since planning/i);
      assert.equal(await readFile(other, "utf8"), "other original");
      assert.equal(
        await readFile(target, "utf8"),
        example === "contents" ? "user edit" : "original",
      );
      await absent(`${f.ledger}.lock`);
    },
  );

  test("an existing apply lock is respected, not stolen or removed", async () => {
    const f = await fixture();
    const result = await f.plan([f.api().text("~/message", () => "new")]);
    await f.file(`${f.ledger}.lock`, "other process");
    await assert.rejects(apply(result), { code: "EEXIST" });
    assert.equal(await readFile(`${f.ledger}.lock`, "utf8"), "other process");
    await absent(join(f.home, "message"));
  });

  test("failed planning writes nothing and reports destination plus declaring module", async () => {
    const f = await fixture();
    const { text, json } = f.api();
    await assert.rejects(
      f.plan([
        text("~/a-first", () => "new"),
        json("~/z-bad", () => {
          throw new Error("intentional failure");
        }),
      ]),
      /base\/config.ts.*z-bad.*intentional failure/,
    );
    await absent(f.home);
  });

  test.each([undefined, 0o640] as const)(
    "transform-only writes preserve existing mode %s or default new files to 0600",
    async (existingMode) => {
      const f = await fixture();
      const path = join(f.home, "message");
      if (existingMode !== undefined) {
        await f.file(path, "old");
        await chmod(path, existingMode);
      }
      await apply(await f.plan([f.api().text("~/message", () => "new")]));
      assert.equal((await lstat(path)).mode & 0o777, existingMode ?? 0o600);
      assert.equal((await lstat(f.ledger)).mode & 0o777, 0o600);
    },
  );

  test("destinations and ledger are atomically replaced rather than overwritten in place", async () => {
    const f = await fixture();
    const path = join(f.home, "message");
    await apply(await f.plan([f.api().text("~/message", () => "old")]));
    const previousLedger = await readFile(f.ledger, "utf8");
    const oldFile = await open(path);
    const oldLedger = await open(f.ledger);
    try {
      await apply(await f.plan([f.api().text("~/message", () => "new")]));
      assert.equal(await oldFile.readFile("utf8"), "old");
      assert.equal(await oldLedger.readFile("utf8"), previousLedger);
      assert.equal(await readFile(path, "utf8"), "new");
      assert.notEqual(await readFile(f.ledger, "utf8"), previousLedger);
      for (const directory of [dirname(path), dirname(f.ledger)]) {
        assert.equal(
          (await readdir(directory)).some((name) => name.startsWith(".fig-")),
          false,
        );
      }
      await absent(`${f.ledger}.lock`);
    } finally {
      await oldFile.close();
      await oldLedger.close();
    }
  });

  // Defensive regression cases: corrupt state must never authorize deletion.
  test.each([
    ["null ledger", "null", /Invalid ownership ledger/],
    ["unknown version", '{"version":2,"files":{}}', /Invalid ownership ledger/],
    ["relative path", '{"version":1,"files":{"../outside":null}}', /Invalid ledger path/],
    ["null ownership", '{"version":1,"files":{"/outside":null}}', /Invalid ledger entry/],
    [
      "invalid hash",
      '{"version":1,"files":{"/outside":{"hash":"bad","mode":384,"cleanup":true,"sources":[]}}}',
      /Invalid ledger entry/,
    ],
  ] as const)("rejects %s", async (_name, contents, error) => {
    const f = await fixture();
    await f.file(f.ledger, contents);
    await assert.rejects(f.plan([]), error);
    assert.equal(await readFile(f.ledger, "utf8"), contents);
  });
});
