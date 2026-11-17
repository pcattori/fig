import { homedir } from "node:os";
import { extname, isAbsolute } from "node:path";
import { resolvePath } from "./paths.ts";
import { createJiti } from "jiti";
import * as api from "./api.ts";
import type { Plugin } from "./api.ts";

const moduleExtensions = new Set([".js", ".mjs", ".ts", ".mts"]);

function isPlugin(value: unknown): value is Plugin {
  if (!value || typeof value !== "object") return false;
  const plugin = value as Record<string, unknown>;
  if (typeof plugin.source !== "string") return false;
  try {
    const source = new URL(plugin.source);
    if (source.protocol !== "file:" || !moduleExtensions.has(extname(source.pathname)))
      return false;
  } catch {
    return false;
  }
  if (plugin.kind === "files") {
    return (
      typeof plugin.from === "string" &&
      isAbsolute(plugin.from) &&
      typeof plugin.to === "string" &&
      isAbsolute(plugin.to)
    );
  }
  return (
    (plugin.kind === "json" || plugin.kind === "text") &&
    typeof plugin.path === "string" &&
    isAbsolute(plugin.path) &&
    typeof plugin.transform === "function"
  );
}

export async function loadPlugins(location: string): Promise<Plugin[]> {
  const configPath = resolvePath(location, process.cwd());
  if (!moduleExtensions.has(extname(configPath))) {
    throw new Error(`${configPath}: configs must be JS/TS ES modules (.js, .mjs, .ts, .mts)`);
  }
  const jiti = createJiti(configPath, {
    virtualModules: { "fig:plugins": api },
    // Import aliases use the same OS home as plugin paths.
    alias: { "~/": `${homedir()}/` },
    tryNative: false,
    moduleCache: false,
    // Planning must not create transpilation caches in user repositories.
    fsCache: false,
  });
  const value = await jiti.import<unknown>(configPath, { default: true });
  if (!Array.isArray(value))
    throw new Error(`${configPath}: default export must be a Plugin[] array`);
  for (const [index, plugin] of value.entries()) {
    if (!isPlugin(plugin))
      throw new Error(
        `${configPath}: invalid plugin at index ${index}; use plugins(import.meta.url) from fig:plugins`,
      );
  }
  return value;
}
