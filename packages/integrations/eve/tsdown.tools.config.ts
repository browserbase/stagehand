import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { web: "src/tools/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist/tools",
  dts: true,
  clean: false,
  deps: {
    skipNodeModulesBundle: true,
  },
  outExtensions: () => ({ js: ".mjs", dts: ".d.ts" }),
});
