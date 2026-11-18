import { describe, test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { reconcile } from "../src/reconcile.ts";
import type { DesiredFile, Ledger, Snapshot } from "../src/reconcile.ts";
import { apply } from "../src/engine.ts";
import { fixture } from "./helpers.ts";

const path = "/test/file";
const snapshot = (contents: string | null, mode = 0o644): Snapshot => ({
  contents: contents === null ? null : Buffer.from(contents),
  mode,
});
const desired = (contents: string, cleanup = true): DesiredFile => ({
  contents: Buffer.from(contents),
  mode: 0o644,
  cleanup,
  sources: ["file:///config.ts"],
});
const empty = (): Ledger => ({ version: 1, files: {} });
const owned = (contents: string, cleanup = true) =>
  reconcile(
    new Map([[path, desired(contents, cleanup)]]),
    new Map([[path, snapshot(null)]]),
    empty(),
  ).ledger;

describe("Ledger and cleanup", () => {
  test("one fixed ledger tracks destinations, hashes, permissions, provenance, and ownership across configs", async () => {
    // Keep a real-FS wiring test for reading the ledger across separate plans.
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
      type: "file",
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
    (example) => {
      const current = new Map([
        [
          path,
          snapshot(
            example === "content edited" ? "user edit" : "managed",
            example === "permissions edited" ? 0o600 : 0o644,
          ),
        ],
      ]);
      const retired = reconcile(new Map(), current, owned("managed"));
      assert.equal(retired.changes[0].action, example === "untouched" ? "delete" : "preserve");
      assert.equal(path in retired.ledger.files, example !== "untouched");
      if (example !== "untouched") {
        assert.equal(reconcile(new Map(), current, retired.ledger).changes[0].action, "preserve");
        assert.equal(
          current.get(path)!.contents!.toString(),
          example === "content edited" ? "user edit" : "managed",
        );
      }
    },
  );

  test.each(['{"applicationState":"keep","theme":"dark"}', '{"theme":"dark"}'])(
    "obsolete transform-only files are preserved and relinquished: %s",
    (contents) => {
      const current = new Map([[path, snapshot(contents)]]);
      const retired = reconcile(new Map(), current, owned(contents, false));
      assert.equal(retired.changes[0].action, "preserve");
      assert.equal(retired.changes[0].after!.toString(), contents);
      assert.equal(path in retired.ledger.files, false);
      assert.equal(reconcile(new Map(), current, retired.ledger).changes.length, 0);
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

  test("a missing ledger never authorizes speculative cleanup", () => {
    const result = reconcile(new Map(), new Map([[path, snapshot("looks managed")]]), empty());
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.ledger, empty());
  });

  // Regression beyond the SPEC: retain compatibility with older persisted data.
  test("earlier provenance records remain readable without losing ownership", async () => {
    const f = await fixture();
    const config = [f.api().text("~/hello", () => "managed")];
    await apply(await f.plan(config));
    const legacy = JSON.parse(await readFile(f.ledger, "utf8"));
    const item = legacy.files[join(f.home, "hello")];
    item.profiles = item.sources;
    delete item.sources;
    await f.file(f.ledger, JSON.stringify(legacy));
    await apply(await f.plan(config));
    const migrated = JSON.parse(await readFile(f.ledger, "utf8"));
    assert.deepEqual(migrated.files[join(f.home, "hello")].sources, [config[0].source]);
    assert.equal("profiles" in migrated.files[join(f.home, "hello")], false);
  });
});
