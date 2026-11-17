import { homedir } from "node:os";
import { resolve, sep } from "node:path";

/** Only a literal leading ~ path segment expands; ~user remains a relative name. */
export function resolvePath(path: string, root: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith(`~${sep}`)) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(root, path);
}
