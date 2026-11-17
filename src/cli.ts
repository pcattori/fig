#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { apply, plan } from "./engine.ts";
import { loadPlugins } from "./loader.ts";
import { render } from "./display.ts";

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      config: { type: "string", short: "c" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
  });
  const [command, ...extra] = positionals;
  if (values.help || !command) {
    console.log(
      "Usage: fig <plan|apply> [-c, --config <file>]\n\nConfig defaults to OS-home .config/fig/config.ts.\nplan shows diffs without writing; apply writes changes and shows a compact summary.",
    );
    return;
  }
  if (!["plan", "apply"].includes(command) || extra.length) {
    throw new Error("Expected <plan|apply> [-c, --config <file>]");
  }
  const result = await plan({
    plugins: await loadPlugins(values.config ?? join(homedir(), ".config/fig/config.ts")),
  });
  if (command === "apply") await apply(result);
  process.stdout.write(render(result, command as "plan" | "apply"));
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
