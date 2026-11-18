import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
  chmod,
  readlink,
  symlink,
  stat as followStat,
  realpath,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Metadata, Plugin } from "./api.ts";
import { homedir } from "node:os";
import { equalContents as equal, reconcile } from "./reconcile.ts";
import type { Change, DesiredFile, Ledger, OwnedFile, Snapshot } from "./reconcile.ts";
export type { Change } from "./reconcile.ts";

type Operation = {
  name: string;
  run: (input: Buffer | null, metadata: Metadata) => Promise<Buffer>;
  owns?: boolean;
  json?: boolean;
};
export interface Plan {
  home: string;
  statePath: string;
  stateBefore: Buffer | null;
  ledger: Ledger;
  changes: Change[];
  unchanged: number;
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

async function stat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// A leaf symlink may be replaced, never followed. Ancestors remain forbidden.
async function safePath(path: string, allowLeafSymlink = false) {
  for (let cursor = resolve(path); ; cursor = dirname(cursor)) {
    const info = await stat(cursor);
    if (info?.isSymbolicLink() && !(allowLeafSymlink && cursor === path))
      throw new Error(`Refusing symlink: ${cursor}`);
    if (cursor !== path && info && !info.isDirectory())
      throw new Error(`Not a directory: ${cursor}`);
    if (dirname(cursor) === cursor) break;
  }
}

async function snapshot(path: string, allowLeafSymlink = false): Promise<Snapshot> {
  await safePath(path, allowLeafSymlink);
  const info = await stat(path);
  if (!info) return { contents: null, mode: 0o600 };
  if (info.isSymbolicLink())
    return { type: "symlink", contents: Buffer.from(await readlink(path)), mode: 0o777 };
  if (!info.isFile()) throw new Error(`Expected a regular file: ${path}`);
  return { type: "file", contents: await readFile(path), mode: info.mode & 0o777 };
}

async function walk(root: string, ancestors = new Set<string>()): Promise<string[]> {
  const canonical = await realpath(root);
  if (ancestors.has(canonical)) throw new Error(`Source symlink cycle: ${root}`);
  const next = new Set([...ancestors, canonical]);
  const info = await followStat(root);
  if (!info.isDirectory()) throw new Error(`Files source must be a directory: ${root}`);
  const files: string[] = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(root, entry.name);
    const info = await followStat(path);
    if (info.isDirectory()) files.push(...(await walk(path, next)));
    else if (info.isFile()) files.push(path);
    else throw new Error(`Unsupported files source: ${path}`);
  }
  return files;
}

function parseLedger(contents: Buffer | null): Ledger {
  if (!contents) return { version: 1, files: {} };
  const value = JSON.parse(contents.toString());
  if (
    !value ||
    value.version !== 1 ||
    !value.files ||
    typeof value.files !== "object" ||
    Array.isArray(value.files)
  ) {
    throw new Error("Invalid ownership ledger");
  }
  for (const [path, record] of Object.entries(value.files)) {
    if (!isAbsolute(path) || resolve(path) !== path || dirname(path) === path) {
      throw new Error(`Invalid ledger path: ${path}`);
    }
    const item = record as OwnedFile & { profiles?: string[] };
    // Read ledgers from the earlier profile-based prototype as well.
    if (item && typeof item === "object") {
      item.sources ??= item.profiles!;
      delete item.profiles;
    }
    if (
      !item ||
      (item.type !== undefined && item.type !== "file" && item.type !== "symlink") ||
      (item.type === "symlink" && item.mode !== 0o777) ||
      typeof item.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.hash) ||
      !Number.isInteger(item.mode) ||
      item.mode < 0 ||
      item.mode > 0o777 ||
      typeof item.cleanup !== "boolean" ||
      !Array.isArray(item.sources) ||
      !item.sources.every((name) => typeof name === "string")
    ) {
      throw new Error(`Invalid ledger entry: ${path}`);
    }
  }
  return value;
}

/** I/O shell: capture inputs, run callbacks, then reconcile plain values. */
export async function plan(options: { plugins: Plugin[] }): Promise<Plan> {
  const home = homedir();
  const statePath = join(home, ".local/state/fig/state.json");
  const stateBefore = (await snapshot(statePath)).contents;
  const previous = parseLedger(stateBefore);
  const pipelines = new Map<string, Operation[]>();
  const add = (path: string, operation: Operation) => {
    if (!isAbsolute(path) || resolve(path) !== path || dirname(path) === path) {
      throw new Error(`Invalid plugin destination in ${operation.name}: ${path}`);
    }
    if (
      [statePath, `${statePath}.lock`].some((state) => inside(path, state) || inside(state, path))
    ) {
      throw new Error(`Target overlaps ledger: ${path}`);
    }
    const operations = pipelines.get(path) ?? [];
    operations.push(operation);
    pipelines.set(path, operations);
  };

  for (const plugin of options.plugins) {
    const name = plugin.source;
    if (plugin.kind === "files") {
      const source = plugin.from;
      const destination = plugin.to;
      for (const file of await walk(source)) {
        const path = join(destination, relative(source, file));
        const contents = await readFile(file);
        const mode = (await followStat(file)).mode & 0o777;
        add(path, {
          name,
          owns: true,
          run: async (_input, metadata) => {
            metadata.type = "file";
            metadata.mode = mode;
            return contents;
          },
        });
      }
    } else if (plugin.kind === "text") {
      add(plugin.path, {
        name,
        run: async (input, metadata) => {
          const output = await plugin.transform(input?.toString("utf8") ?? "", metadata);
          if (typeof output !== "string") throw new Error("Text transforms must return a string");
          return Buffer.from(output);
        },
      });
    } else if (plugin.kind === "json") {
      add(plugin.path, {
        name,
        json: true,
        run: async (input, metadata) => {
          if (metadata.type === "symlink")
            throw new Error("JSON transforms require a regular file");
          const config = input === null ? {} : JSON.parse(input.toString("utf8"));
          const before = JSON.stringify(config);
          const result = await plugin.transform(config, metadata);
          const output = result === undefined ? config : result;
          const serialized = JSON.stringify(output);
          if (serialized === undefined)
            throw new Error("JSON transform returned an unserializable value");
          // Preserve original whitespace when this step makes no semantic change.
          if (input !== null && before === serialized) return input;
          return Buffer.from(`${JSON.stringify(output, null, 2)}\n`);
        },
      });
    } else {
      throw new Error(`Unknown plugin kind in ${name}`);
    }
  }

  // Detect file-vs-directory conflicts before reading or writing destinations.
  const paths = [...pipelines.keys()].sort();
  const pathSet = new Set(paths);
  for (const path of paths) {
    for (let parent = dirname(path); ; parent = dirname(parent)) {
      if (pathSet.has(parent)) throw new Error(`File/directory conflict: ${parent} and ${path}`);
      if (dirname(parent) === parent) break;
    }
  }

  const current = new Map<string, Snapshot>();
  for (const path of new Set([...paths, ...Object.keys(previous.files)])) {
    if (
      [statePath, `${statePath}.lock`].some((state) => inside(path, state) || inside(state, path))
    ) {
      throw new Error(`Ledger entry overlaps state: ${path}`);
    }
    current.set(path, await snapshot(path, true));
  }

  const desired = new Map<string, DesiredFile>();
  for (const path of paths) {
    const operations = pipelines.get(path)!;
    const initial = current.get(path)!;
    const metadata: Metadata = { type: initial.type ?? "file", mode: initial.mode };
    const run = async (input: Buffer | null) => {
      let output = input;
      let jsonStart: Buffer | null | undefined;
      const finishJson = () => {
        // Intermediate edits must not introduce formatting-only drift.
        if (
          jsonStart !== undefined &&
          jsonStart !== null &&
          output !== null &&
          JSON.stringify(JSON.parse(jsonStart.toString())) ===
            JSON.stringify(JSON.parse(output.toString()))
        ) {
          output = jsonStart;
        }
        jsonStart = undefined;
      };
      for (const operation of operations) {
        if (operation.json && jsonStart === undefined) jsonStart = output;
        if (!operation.json) finishJson();
        try {
          output = await operation.run(output, metadata);
          if (metadata.type !== "file" && metadata.type !== "symlink")
            throw new Error("Invalid file type");
          if (!Number.isInteger(metadata.mode) || metadata.mode < 0 || metadata.mode > 0o777)
            throw new Error("Invalid file mode (expected 000–777)");
          if (metadata.type === "symlink") {
            if (metadata.mode !== 0o777) throw new Error("Symlink mode must be 777");
            if (
              !output.length ||
              output.includes(0) ||
              !Buffer.from(output.toString()).equals(output)
            )
              throw new Error("Invalid symlink target");
          }
        } catch (error) {
          throw new Error(`${operation.name}: ${path}: ${(error as Error).message}`, {
            cause: error,
          });
        }
      }
      finishJson();
      return output!;
    };
    const after = await run(initial.contents);
    const sources = [...new Set(operations.map((operation) => operation.name))];
    const { type, mode } = metadata;
    // A files plugin declares whole-file ownership. Transforms alone do not:
    // their output can contain application-owned fields, even if freshly created.
    desired.set(path, {
      contents: after,
      type,
      mode,
      cleanup: operations.some((operation) => operation.owns),
      sources,
    });
  }

  return { home, statePath, stateBefore, ...reconcile(desired, current, previous) };
}

async function atomicWrite(
  path: string,
  contents: Buffer,
  mode: number,
  type: "file" | "symlink" = "file",
  allowLeafSymlink = false,
) {
  await safePath(path, allowLeafSymlink);
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.fig-${randomUUID()}.tmp`);
  try {
    if (type === "symlink") await symlink(contents.toString(), temporary);
    else {
      await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
      await chmod(temporary, mode);
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function apply(result: Plan) {
  // A per-ledger lock prevents concurrent applies using this state file.
  await safePath(result.statePath);
  await mkdir(dirname(result.statePath), { recursive: true });
  const lock = `${result.statePath}.lock`;
  await writeFile(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
  try {
    if (!equal((await snapshot(result.statePath)).contents, result.stateBefore)) {
      throw new Error("Ledger changed since planning; run again");
    }
    // Preflight all affected files before making the first change.
    for (const change of result.changes) {
      const current = await snapshot(change.path, true);
      if (
        !equal(current.contents, change.before) ||
        current.mode !== change.beforeMode ||
        (current.type ?? "file") !== (change.beforeType ?? "file")
      ) {
        throw new Error(`File changed since planning: ${change.path}`);
      }
    }
    for (const change of result.changes) {
      if (change.action === "write")
        await atomicWrite(change.path, change.after!, change.mode, change.type, true);
      else if (change.action === "delete") await unlink(change.path);
    }
    await atomicWrite(
      result.statePath,
      Buffer.from(`${JSON.stringify(result.ledger, null, 2)}\n`),
      0o600,
    );
  } finally {
    await unlink(lock);
  }
}
