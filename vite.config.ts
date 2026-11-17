import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/cli.ts", "src/api.ts"],
    format: "esm",
    platform: "node",
    target: "node26",
    dts: true,
    clean: true,
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
  run: {
    tasks: {
      build: { command: "vp pack", cache: false },
      test: { command: "vp test run", dependsOn: ["build"], cache: false },
      typecheck: { command: "tsc --noEmit", dependsOn: ["build"], cache: false },
    },
  },
});
