import { dirname } from "node:path";
import { resolvePath } from "./paths.ts";
import { fileURLToPath } from "node:url";

/** Symlink contents are the link target, never the referent. */
export interface Metadata {
  type: "file" | "symlink";
  mode: number;
}
export type Transform<T> = (config: T, metadata: Metadata) => void | T | Promise<void | T>;
export type TextTransform = (text: string, metadata: Metadata) => string | Promise<string>;
export type Plugin = { source: string } & (
  | { kind: "files"; from: string; to: string }
  | { kind: "json"; path: string; transform: Transform<any> }
  | { kind: "text"; path: string; transform: TextTransform }
);

/** Bind both source and destination paths to the declaring module. */
export function plugins(moduleUrl: string | URL) {
  const url = new URL(moduleUrl);
  if (url.protocol !== "file:")
    throw new Error("plugins() requires a file module URL (use import.meta.url)");
  const source = url.href;
  const root = dirname(fileURLToPath(url));
  return {
    files: (from: string, to = "~"): Plugin => ({
      kind: "files",
      source,
      from: resolvePath(from, root),
      to: resolvePath(to, root),
    }),
    json: <T = Record<string, any>>(path: string, transform: Transform<T>): Plugin => ({
      kind: "json",
      source,
      path: resolvePath(path, root),
      transform,
    }),
    text: (path: string, transform: TextTransform): Plugin => ({
      kind: "text",
      source,
      path: resolvePath(path, root),
      transform,
    }),
  };
}
