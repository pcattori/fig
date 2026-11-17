import { isUtf8 } from "node:buffer";
import { isAbsolute, relative, sep } from "node:path";
import { FILE_HEADERS_ONLY, formatPatch, structuredPatch } from "diff";
import type { Change, Plan } from "./engine.ts";

function label(path: string, home: string) {
  const rel = relative(home, path);
  const display =
    rel === ""
      ? "~"
      : rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
        ? `~/${rel}`
        : path;
  const hasControlCharacters = [...display].some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
  return hasControlCharacters ? JSON.stringify(display) : display;
}

const mode = (value: number) => value.toString(8).padStart(3, "0");
const binary = (value: Buffer | null) => value !== null && (value.includes(0) || !isUtf8(value));

function diff(change: Change, path: string) {
  if (change.action === "preserve" || change.before?.equals(change.after ?? Buffer.alloc(0))) {
    return { added: 0, removed: 0, description: "", patch: "" };
  }
  if (binary(change.before) || binary(change.after)) {
    return {
      added: 0,
      removed: 0,
      description: `binary (${change.before?.length ?? 0} → ${change.after?.length ?? 0} bytes)`,
      patch: "",
    };
  }
  const patch = structuredPatch(
    change.before === null ? "/dev/null" : `${path} (before)`,
    change.after === null ? "/dev/null" : `${path} (after)`,
    change.before?.toString("utf8") ?? "",
    change.after?.toString("utf8") ?? "",
    undefined,
    undefined,
    { context: 3, timeout: 1000 },
  );
  if (!patch)
    return {
      added: 0,
      removed: 0,
      description: "text changed (diff computation limit; line counts unavailable)",
      patch: "",
    };
  let added = 0,
    removed = 0;
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  }
  return {
    added,
    removed,
    description: `+${added} -${removed}`,
    patch: patch.hunks.length ? formatPatch(patch, FILE_HEADERS_ONLY) : "",
  };
}

/** Rendering only: no subprocesses, filesystem writes, or plugin execution. */
export function render(result: Plan, command: "plan" | "apply"): string {
  const lines: string[] = [];
  let added = 0,
    removed = 0,
    changed = 0,
    permissions = 0,
    preserved = 0,
    unavailable = 0;
  for (const change of result.changes) {
    const path = label(change.path, result.home);
    if (change.action === "preserve") {
      preserved++;
      const reason = result.ledger.files[change.path]
        ? "modified; no longer managed"
        : "shared file; no longer managed";
      lines.push(`KEPT     ${path}  ${reason}`);
      continue;
    }
    changed++;
    const contentChanged =
      change.before === null || change.after === null || !change.before.equals(change.after);
    const modeChanged =
      change.action === "write" && change.before !== null && change.beforeMode !== change.mode;
    if (modeChanged) permissions++;
    const status =
      change.action === "delete"
        ? "DELETED"
        : change.before === null
          ? "CREATED"
          : !contentChanged
            ? "MODE"
            : "UPDATED";
    const details = diff(change, path);
    added += details.added;
    removed += details.removed;
    if (details.description.includes("line counts unavailable")) unavailable++;
    const annotation = [
      details.description,
      modeChanged ? `${mode(change.beforeMode)} → ${mode(change.mode)}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    lines.push(`${status.padEnd(8)} ${path}${annotation ? `  ${annotation}` : ""}`);
    if (command === "plan" && details.patch) lines.push(details.patch.trimEnd());
  }
  lines.push(
    `${changed} files changed, +${added} -${removed}; ${permissions} permission changes; ${preserved} preserved; ${result.unchanged} unchanged${unavailable ? `; line counts unavailable for ${unavailable} files` : ""}`,
  );
  return `${lines.join("\n")}\n`;
}
