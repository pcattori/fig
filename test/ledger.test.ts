import { describe, test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { apply } from "../src/engine.ts";
import { absent, fixture } from "./helpers.ts";

describe("Ledger and cleanup", () => {
  test("one fixed ledger tracks destinations, hashes, permissions, provenance, and ownership across configs", async () => {
    const f = await fixture();
    await f.file(join(f.root, "base/input/copied"), "managed");
    await chmod(join(f.root, "base/input/copied"), 0o755);
    const first = await f.plan([
      f.api().files("./input", "./outside-home"),
      f.api("work").json("~/shared.json", (value) => {
        value.enabled = true;
      }),
    ]);
    const copied = join(f.root, "base/outside-home/copied");
    assert.equal(first.statePath, f.ledger);
    assert.deepEqual(first.ledger.files[copied], {
      hash: createHash("sha256").update("managed").digest("hex"),
      mode: 0o755,
      cleanup: true,
      sources: [f.module().href],
    });
    assert.equal(first.ledger.files[join(f.home, "shared.json")].cleanup, false);
    await apply(first);
    const second = await f.plan([f.api("alternate").text("~/other", () => "other")]);
    assert.equal(second.statePath, first.statePath);
    assert.equal(second.changes.find((change) => change.path === copied)!.action, "delete");
  });

  test.each(["untouched", "content edited", "permissions edited"] as const)(
    "obsolete whole-file ownership: %s",
    async (example) => {
      const f = await fixture();
      await f.file(join(f.root, "base/input/copied"), "managed");
      await chmod(join(f.root, "base/input/copied"), 0o644);
      await apply(await f.plan([f.api().files("./input")]));
      const path = join(f.home, "copied");
      if (example === "content edited") await f.file(path, "user edit");
      if (example === "permissions edited") await chmod(path, 0o600);
      const retired = await f.plan([]);
      assert.equal(retired.changes[0].action, example === "untouched" ? "delete" : "preserve");
      await apply(retired);
      if (example === "untouched") {
        await absent(path);
        assert.equal(path in (await f.plan([])).ledger.files, false);
      } else {
        assert.equal(
          await readFile(path, "utf8"),
          example === "content edited" ? "user edit" : "managed",
        );
        assert.equal((await f.plan([])).changes[0].action, "preserve");
      }
    },
  );

  test.each(["preexisting", "created by transform"] as const)(
    "obsolete transform-only files are preserved and relinquished: %s",
    async (example) => {
      const f = await fixture();
      const path = join(f.home, "shared.json");
      if (example === "preexisting") await f.file(path, '{"applicationState":"keep"}');
      await apply(
        await f.plan([
          f.api().json("~/shared.json", (value) => {
            value.theme = "dark";
          }),
        ]),
      );
      const before = await readFile(path, "utf8");
      const retired = await f.plan([]);
      assert.equal(retired.changes[0].action, "preserve");
      assert.equal(path in retired.ledger.files, false);
      await apply(retired);
      assert.equal(await readFile(path, "utf8"), before);
      assert.equal((await f.plan([])).changes.length, 0);
    },
  );

  test("missing obsolete files are forgotten and empty directories remain", async () => {
    const f = await fixture();
    await f.file(join(f.root, "base/input/nested/manual"), "manual");
    await f.file(join(f.root, "base/input/nested/automatic"), "automatic");
    await apply(await f.plan([f.api().files("./input")]));
    await unlink(join(f.home, "nested/manual"));
    const retired = await f.plan([]);
    assert.deepEqual(
      retired.changes.map((change) => change.path),
      [join(f.home, "nested/automatic")],
    );
    await apply(retired);
    assert.deepEqual((await f.plan([])).ledger.files, {});
    assert.ok((await lstat(join(f.home, "nested"))).isDirectory());
  });

  test("a missing ledger never authorizes speculative cleanup", async () => {
    const f = await fixture();
    await f.file(join(f.root, "base/input/copied"), "managed");
    await apply(await f.plan([f.api().files("./input")]));
    await unlink(f.ledger);
    const unknown = await f.plan([]);
    assert.equal(unknown.changes.length, 0);
    await apply(unknown);
    assert.equal(await readFile(join(f.home, "copied"), "utf8"), "managed");
  });

  // Regression coverage beyond the SPEC: do not discard older ownership records.
  test("earlier provenance records remain readable without losing ownership", async () => {
    const f = await fixture();
    const config = [f.api().text("~/hello", () => "managed")];
    await apply(await f.plan(config));
    const legacy = JSON.parse(await readFile(f.ledger, "utf8"));
    const owned = legacy.files[join(f.home, "hello")];
    owned.profiles = owned.sources;
    delete owned.sources;
    await f.file(f.ledger, JSON.stringify(legacy));
    await apply(await f.plan(config));
    const migrated = JSON.parse(await readFile(f.ledger, "utf8"));
    assert.deepEqual(migrated.files[join(f.home, "hello")].sources, [config[0].source]);
    assert.equal("profiles" in migrated.files[join(f.home, "hello")], false);
  });
});
