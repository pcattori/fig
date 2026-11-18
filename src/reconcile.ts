import { createHash } from "node:crypto";

export interface Snapshot {
  contents: Buffer | null;
  mode: number;
}
export interface OwnedFile {
  hash: string;
  mode: number;
  cleanup: boolean;
  sources: string[];
}
export interface Ledger {
  version: 1;
  files: Record<string, OwnedFile>;
}
export interface DesiredFile {
  contents: Buffer;
  mode: number;
  cleanup: boolean;
  sources: string[];
}
export interface Change {
  path: string;
  action: "write" | "delete" | "preserve";
  before: Buffer | null;
  after: Buffer | null;
  mode: number;
  beforeMode: number;
  sources: string[];
}

export const equalContents = (a: Buffer | null, b: Buffer | null) =>
  a === null ? b === null : b !== null && a.equals(b);
const hash = (contents: Buffer) => createHash("sha256").update(contents).digest("hex");

/** Pure decisions from captured values. Snapshot bytes are treated as immutable. */
export function reconcile(
  desired: ReadonlyMap<string, DesiredFile>,
  current: ReadonlyMap<string, Snapshot>,
  previous: Ledger,
): { changes: Change[]; ledger: Ledger; unchanged: number } {
  const changes: Change[] = [];
  const ledger: Ledger = { version: 1, files: {} };
  let unchanged = 0;
  const snapshot = (path: string) => {
    const value = current.get(path);
    if (!value) throw new Error(`Missing snapshot: ${path}`);
    return value;
  };

  for (const path of [...desired.keys()].sort()) {
    const before = snapshot(path);
    const after = desired.get(path)!;
    ledger.files[path] = {
      hash: hash(after.contents),
      mode: after.mode,
      cleanup: after.cleanup,
      sources: [...after.sources],
    };
    if (equalContents(before.contents, after.contents) && before.mode === after.mode) unchanged++;
    else
      changes.push({
        path,
        action: "write",
        before: before.contents,
        after: after.contents,
        mode: after.mode,
        beforeMode: before.mode,
        sources: [...after.sources],
      });
  }

  for (const [path, owned] of Object.entries(previous.files)) {
    if (desired.has(path)) continue;
    const before = snapshot(path);
    if (before.contents === null) continue;
    if (owned.cleanup && hash(before.contents) === owned.hash && before.mode === owned.mode) {
      changes.push({
        path,
        action: "delete",
        before: before.contents,
        after: null,
        mode: before.mode,
        beforeMode: before.mode,
        sources: [...owned.sources],
      });
    } else {
      changes.push({
        path,
        action: "preserve",
        before: before.contents,
        after: before.contents,
        mode: before.mode,
        beforeMode: before.mode,
        sources: [...owned.sources],
      });
      // Modified whole-owned files remain tracked; shared files are relinquished.
      if (owned.cleanup) ledger.files[path] = { ...owned, sources: [...owned.sources] };
    }
  }
  return { changes, ledger, unchanged };
}
