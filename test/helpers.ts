import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, lstat, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { onTestFinished, vi } from "vite-plus/test";
import { plugins } from "../src/api.ts";
import type { Plugin } from "../src/api.ts";
import { plan } from "../src/engine.ts";

const cli = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url));

/** Each test owns a temporary home. Keep tests sequential within a file: HOME is process-global. */
export async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fig-test-")));
  const home = join(root, "home");
  const ledger = join(home, ".local/state/fig/state.json");
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  onTestFinished(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });
  const file = async (path: string, contents: string | Buffer) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  };
  const run = (
    args: string[],
    options: { env?: Record<string, string>; cwd?: string; nodeArgs?: string[] } = {},
  ) =>
    spawnSync(process.execPath, [...(options.nodeArgs ?? []), cli, ...args], {
      cwd: options.cwd ?? root,
      encoding: "utf8",
      env: { ...process.env, ...options.env, HOME: home, USERPROFILE: home },
    });
  const dependency = async (directory: string, name: string, code: string) => {
    await file(
      join(directory, "node_modules", name, "package.json"),
      JSON.stringify({ main: "index.cjs" }),
    );
    await file(join(directory, "node_modules", name, "index.cjs"), code);
  };
  return {
    root,
    home,
    ledger,
    file,
    run,
    dependency,
    module: (name = "base") => pathToFileURL(join(root, name, "config.ts")),
    api: (name = "base") => plugins(pathToFileURL(join(root, name, "config.ts"))),
    plan: (plugins: Plugin[]) => plan({ plugins }),
  };
}

export const absent = (path: string) => assert.rejects(lstat(path), { code: "ENOENT" });
