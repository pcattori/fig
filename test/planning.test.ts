import { describe, test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { render } from "../src/display.ts";
import type { Change, Plan } from "../src/engine.ts";
import { absent, fixture } from "./helpers.ts";

function change(options: Partial<Change> = {}): Change {
  return {
    path: "/home/test/settings",
    action: "write",
    before: Buffer.from("old\n"),
    after: Buffer.from("new\n"),
    beforeMode: 0o644,
    mode: 0o644,
    sources: ["file:///private/config.ts"],
    ...options,
  };
}
function plan(changes: Change[]): Plan {
  return {
    home: "/home/test",
    statePath: "/home/test/.local/state/fig/state.json",
    stateBefore: null,
    ledger: { version: 1, files: {} },
    changes,
    unchanged: 0,
  };
}

describe("Planning and applying", () => {
  test.each(["plan", "apply"] as const)(
    "%s has fixed output: line counts/totals, full diffs only for plan, and no routine provenance",
    (command) => {
      const output = render(plan([change()]), command);
      assert.match(
        output,
        command === "plan" ? /^~\/settings\n  @@/ : /UPDATED\s+~\/settings\s+\+1 -1/,
      );
      assert.match(output, /1 files changed/);
      assert.match(output, /\+1 -1/);
      assert.doesNotMatch(output, /private\/config.ts/);
      if (command === "plan") {
        assert.doesNotMatch(output, /---|\+\+\+/);
        assert.match(output, /  -old\n  \+new/);
      } else assert.doesNotMatch(output, /@@|---|\+\+\+|old\n|new\n/);
    },
  );

  test("plan shows built-in diffs without Git/system diff and writes neither destinations nor ledger", async () => {
    const f = await fixture();
    await f.file(
      join(f.root, "config.ts"),
      `
      import {plugins} from 'fig:plugins';
      const {text} = plugins(import.meta.url);
      export default [text('~/message', () => 'hello\\n')];
    `,
    );
    const result = f.run(["plan", "-c", "config.ts"], { env: { PATH: "" } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /@@/);
    assert.match(result.stdout, /\+hello/);
    await absent(f.home);
  });

  test("apply recomputes from current contents and prints summaries, not the preceding plan's full diff", async () => {
    const f = await fixture();
    await f.file(join(f.home, "message"), "first\n");
    await f.file(
      join(f.root, "config.ts"),
      `
      import {plugins} from 'fig:plugins';
      const {text} = plugins(import.meta.url);
      export default [text('~/message', current => current + 'suffix\\n')];
    `,
    );
    const preview = f.run(["plan", "-c", "config.ts"]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /\+suffix/);
    await f.file(join(f.home, "message"), "second\n");
    const applied = f.run(["apply", "-c", "config.ts"]);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(await readFile(join(f.home, "message"), "utf8"), "second\nsuffix\n");
    assert.match(applied.stdout, /UPDATED.*\+1 -0/);
    assert.doesNotMatch(applied.stdout, /@@|first|second|suffix/);
  });

  test.each([
    ["creation", null, "one\ntwo", "CREATED", "+2 -0"],
    ["deletion", "old\n", null, "DELETED", "+0 -1"],
    ["empty creation", null, "", "CREATED", "+0 -0"],
    ["empty deletion", "", null, "DELETED", "+0 -0"],
  ] as const)("reports %s with accurate line counts", (_name, before, after, status, counts) => {
    const output = render(
      plan([
        change({
          action: after === null ? "delete" : "write",
          before: before === null ? null : Buffer.from(before),
          after: after === null ? null : Buffer.from(after),
        }),
      ]),
      "plan",
    );
    assert.ok(output.includes(status === "CREATED" ? "+file:644" : "-file:644"));
    if (counts !== "+0 -0") assert.ok(output.includes(counts));
    else assert.match(output, /contents unchanged/);
    if (after && !after.endsWith("\n")) assert.match(output, /No newline at end of file/);
  });

  test.each([Buffer.from([0, 1, 2]), Buffer.from([255])])(
    "binary/invalid UTF-8 output gets markers instead of line counts or text hunks: %j",
    (bytes) => {
      const output = render(plan([change({ before: null, after: bytes })]), "plan");
      assert.match(output, /\+file:644\n  binary/);
      assert.doesNotMatch(output, /@@|�/);
    },
  );

  test.each([false, true])(
    "reports permission changes, with simultaneous content change: %s",
    (contentChanged) => {
      const output = render(
        plan([change({ after: Buffer.from(contentChanged ? "new\n" : "old\n"), mode: 0o755 })]),
        "apply",
      );
      assert.ok(output.startsWith(contentChanged ? "UPDATED" : "MODE"));
      assert.match(output, /644 → 755/);
      assert.match(output, /1 permission changes/);
    },
  );

  test.each([false, true])(
    "reports preserved obsolete files without diffing them; whole-owned: %s",
    (wholeOwned) => {
      const preserved = change({ action: "preserve" });
      const result = plan([preserved]);
      if (wholeOwned)
        result.ledger.files[preserved.path] = {
          hash: "a".repeat(64),
          mode: 0o644,
          cleanup: true,
          sources: preserved.sources,
        };
      const output = render(result, "plan");
      assert.match(output, /kept: .*no longer managed/);
      assert.ok(output.includes(wholeOwned ? "modified" : "shared file"));
      assert.match(output, /0 files changed.*1 preserved/);
      assert.doesNotMatch(output, /@@/);
    },
  );

  test("diffs exact JSON contents rather than normalizing key order and formatting", () => {
    const output = render(
      plan([
        change({
          before: Buffer.from('{"a":1,"b":2}\n'),
          after: Buffer.from('{ "b": 2, "a": 1 }\n'),
        }),
      ]),
      "plan",
    );
    assert.match(output, /-\{"a":1,"b":2\}/);
    assert.match(output, /\+\{ "b": 2, "a": 1 \}/);
  });

  test.each(
    [
      ["unknown"],
      ["plan", "config.ts"],
      ["plan", "-c"],
      ["plan", "--config"],
      ["plan", "--home", "x"],
      ["plan", "--ledger", "x"],
      ["plan", "--diff"],
      ["plan", "--verbose"],
      ["plan", "--pager", "less"],
      ["plan", "--diff-tool", "git"],
    ].map((args) => ({ args })),
  )(
    "rejects positional paths, incomplete config overrides, and out-of-scope flags: $args",
    async ({ args }) => {
      const f = await fixture();
      assert.notEqual(f.run(args).status, 0);
      await absent(f.home);
    },
  );

  test("plan separates file blocks and keeps metadata before hunks", () => {
    const output = render(
      plan([
        change({
          path: "/home/test/link",
          beforeType: "symlink",
          beforeMode: 0o777,
          diffBefore: Buffer.from("new\n"),
          mode: 0o600,
        }),
        change({ mode: 0o600 }),
      ]),
      "plan",
    );
    assert.match(
      output,
      /^~\/link\n  -symlink \+file:600\n\n~\/settings\n  -file:644 \+file:600\n  @@/,
    );
    assert.doesNotMatch(output, /777|TYPE|MODE|\u001b/);
  });

  test("plan colors paths, metadata, hunks and context without changing plain output", () => {
    const result = plan([
      change({
        before: Buffer.from("same\nold\n"),
        after: Buffer.from("same\nnew\n"),
        mode: 0o600,
      }),
    ]);
    const output = render(result, "plan", { color: true });
    assert.ok(output.includes("\u001b[1m~/settings\u001b[0m"));
    assert.ok(output.includes("\u001b[31m-file:644\u001b[0m \u001b[32m+file:600\u001b[0m"));
    assert.ok(output.includes("\u001b[34m@@"));
    assert.ok(output.includes("\u001b[2m same\u001b[0m"));
    assert.ok(output.includes("\u001b[31m-old\u001b[0m"));
    assert.ok(output.includes("\u001b[32m+new\u001b[0m"));
    assert.equal(output.replace(/\u001b\[\d+m/g, ""), render(result, "plan"));
  });

  // Defensive display regression beyond the SPEC: keep path labels safe and unambiguous.
  test("outside-home path labels stay absolute and escape terminal control characters", () => {
    const output = render(plan([change({ path: "/home/test-other/escape\n\u001b[31m" })]), "apply");
    assert.match(output, /"\/home\/test-other\/escape\\n\\u001b\[31m"/);
    assert.equal(output.includes("\u001b"), false);
  });
});
