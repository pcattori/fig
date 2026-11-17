import { describe, test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { apply } from "../src/engine.ts";
import { absent, fixture } from "./helpers.ts";

describe("Transform execution", () => {
  test.each([
    ["replacement → replacement", ["base", "work"], "work"],
    ["replacement → transform", ["base", "transform"], "transformed"],
    ["transform → replacement", ["transform", "base"], "base"],
    ["transform → transform", ["transform", "last"], "last"],
  ] as const)("array order determines output: %s", async (_name, order, expected) => {
    const f = await fixture();
    await f.file(join(f.root, "base/input/settings.json"), '{"theme":"base"}');
    await f.file(join(f.root, "work/input/settings.json"), '{"theme":"work"}');
    const { json } = f.api();
    const choices = {
      base: f.api("base").files("./input"),
      work: f.api("work").files("./input"),
      transform: json("~/settings.json", (value) => {
        value.theme = "transformed";
      }),
      last: json("~/settings.json", (value) => {
        value.theme = "last";
      }),
    };
    const result = await f.plan(order.map((name) => choices[name]));
    assert.equal(JSON.parse(result.changes[0].after!.toString()).theme, expected);
  });

  test.each(["mutate JSON", "replace JSON", "replace text"] as const)(
    "supports async %s using missing-file defaults",
    async (operation) => {
      const f = await fixture();
      const { json, text } = f.api();
      const plugin =
        operation === "replace text"
          ? text("~/settings", async (current) => {
              assert.equal(current, "");
              return "text\n";
            })
          : json<unknown>("~/settings", async (current) => {
              assert.deepEqual(current, {});
              if (operation === "replace JSON") return ["replacement"];
              (current as Record<string, unknown>).theme = "dark";
            });
      const result = await f.plan([plugin]);
      const expected =
        operation === "replace text"
          ? "text\n"
          : operation === "replace JSON"
            ? '[\n  "replacement"\n]\n'
            : '{\n  "theme": "dark"\n}\n';
      assert.equal(result.changes[0].after!.toString(), expected);
    },
  );

  test("starts from live JSON, preserves unmanaged fields, and leaves array policies to user code", async () => {
    const f = await fixture();
    const path = join(f.home, "settings.json");
    await f.file(path, '{"changelogVersion":"noisy","theme":"old"}');
    const { json } = f.api();
    const config = [
      json("~/settings.json", (value) => {
        value.theme = "base";
        value.list = ["base"];
      }),
      f.api("work").json("~/settings.json", (value) => {
        value.theme = "work";
        value.list.push("work");
      }),
    ];
    await apply(await f.plan(config));
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      changelogVersion: "noisy",
      theme: "work",
      list: ["base", "work"],
    });
    const live = '{"changelogVersion":"newer","theme":"work","list":["base","work"]}';
    await f.file(path, live);
    assert.equal((await f.plan(config)).changes.length, 0);
    assert.equal(await readFile(path, "utf8"), live);
  });

  test.each(["no-op", "temporary changes restored"] as const)(
    "preserves original JSON bytes for %s",
    async (example) => {
      const f = await fixture();
      const original = '{  "theme" : "dark" }';
      await f.file(join(f.home, "settings.json"), original);
      const { json } = f.api();
      const config =
        example === "no-op"
          ? [
              json("~/settings.json", (value) => {
                value.theme = "dark";
              }),
            ]
          : [
              json("~/settings.json", (value) => {
                value.theme = "light";
              }),
              json("~/settings.json", (value) => {
                value.theme = "dark";
              }),
            ];
      const result = await f.plan(config);
      assert.equal(result.changes.length, 0);
      assert.equal(await readFile(join(f.home, "settings.json"), "utf8"), original);
    },
  );

  test.each(['{"theme":"dark",}', '{/* comment */ "theme":"dark"}', "not JSON"])(
    "accepts strict JSON only, rejecting %s without clobbering it",
    async (input) => {
      const f = await fixture();
      const path = join(f.home, "settings.json");
      await f.file(path, input);
      await assert.rejects(
        f.plan([f.api().json("~/settings.json", () => ({}))]),
        /base.*settings.json/,
      );
      assert.equal(await readFile(path, "utf8"), input);
      await absent(f.ledger);
    },
  );

  test("evaluates callbacks once per plan, accepts non-idempotence, and does not rerun on apply", async () => {
    const f = await fixture();
    let calls = 0;
    const config = [
      f.api().json("~/settings.json", (value) => {
        calls++;
        value.list ??= [];
        value.list.push("x");
      }),
    ];
    const first = await f.plan(config);
    assert.equal(calls, 1);
    await apply(first);
    assert.equal(calls, 1);
    const second = await f.plan(config);
    assert.equal(calls, 2);
    assert.deepEqual(JSON.parse(second.changes[0].after!.toString()).list, ["x", "x"]);
  });

  test("text transforms read live UTF-8 and must return a string", async () => {
    const f = await fixture();
    const path = join(f.home, "message");
    await f.file(path, "old café\n");
    const result = await f.plan([
      f.api().text("~/message", (current) => current.replace("old", "new")),
    ]);
    assert.equal(result.changes[0].after!.toString(), "new café\n");
    // JavaScript user modules can return values the TypeScript signature disallows.
    await assert.rejects(
      f.plan([f.api().text("~/message", () => undefined as unknown as string)]),
      /Text transforms must return a string/,
    );
  });
});
