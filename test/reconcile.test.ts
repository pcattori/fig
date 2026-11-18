import { describe, test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { reconcile } from "../src/reconcile.ts";
import type { DesiredFile, Ledger, Snapshot } from "../src/reconcile.ts";

const path = "/test/file";
const source = "file:///config.ts";
const file = (contents: string, mode = 0o644): DesiredFile => ({
  contents: Buffer.from(contents),
  mode,
  cleanup: true,
  sources: [source],
});
const snapshot = (contents: string | null, mode = 0o644): Snapshot => ({
  contents: contents === null ? null : Buffer.from(contents),
  mode,
});
const empty = (): Ledger => ({ version: 1, files: {} });

describe("Planning and applying: pure decisions", () => {
  test.each([
    ["create", null, 0o600, "new", 0o644, true],
    ["update contents", "old", 0o644, "new", 0o644, true],
    ["update permissions", "same", 0o644, "same", 0o755, true],
    ["unchanged", "same", 0o644, "same", 0o644, false],
    ["create empty", null, 0o600, "", 0o600, true],
  ] as const)(
    "computes %s from captured values",
    (_name, before, beforeMode, after, afterMode, changed) => {
      const result = reconcile(
        new Map([[path, file(after, afterMode)]]),
        new Map([[path, snapshot(before, beforeMode)]]),
        empty(),
      );
      assert.equal(result.changes.length, changed ? 1 : 0);
      assert.equal(result.unchanged, changed ? 0 : 1);
      if (changed) {
        const change = result.changes[0];
        assert.equal(change.action, "write");
        assert.equal(change.before?.toString() ?? null, before);
        assert.equal(change.after!.toString(), after);
        assert.equal(change.beforeMode, beforeMode);
        assert.equal(change.mode, afterMode);
      }
      assert.deepEqual(result.ledger.files[path], {
        hash: createHash("sha256").update(after).digest("hex"),
        mode: afterMode,
        cleanup: true,
        sources: [source],
      });
    },
  );

  test.each(["desired", "obsolete"] as const)(
    "missing %s snapshots are errors, not assumed absence",
    (kind) => {
      const previous = reconcile(
        new Map([[path, file("managed")]]),
        new Map([[path, snapshot(null)]]),
        empty(),
      ).ledger;
      assert.throws(
        () =>
          reconcile(
            kind === "desired" ? new Map([[path, file("managed")]]) : new Map(),
            new Map(),
            kind === "obsolete" ? previous : empty(),
          ),
        /Missing snapshot/,
      );
    },
  );

  test("decisions are repeatable and do not mutate their inputs", () => {
    const desired = new Map([[path, file("new")]]);
    const current = new Map([
      [path, snapshot("old")],
      ["/test/retired", snapshot("user edit")],
    ]);
    const previous: Ledger = {
      version: 1,
      files: {
        "/test/retired": { hash: "a".repeat(64), mode: 0o644, cleanup: true, sources: [source] },
      },
    };
    Object.freeze(desired.get(path)!.sources);
    Object.freeze(desired.get(path)!);
    Object.freeze(current.get(path)!);
    Object.freeze(previous.files["/test/retired"].sources);
    Object.freeze(previous.files["/test/retired"]);
    Object.freeze(previous.files);
    const before = JSON.stringify({ desired: [...desired], current: [...current], previous });
    assert.deepEqual(reconcile(desired, current, previous), reconcile(desired, current, previous));
    assert.equal(
      JSON.stringify({ desired: [...desired], current: [...current], previous }),
      before,
    );
  });
});
