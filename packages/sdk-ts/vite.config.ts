import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "vp pack",
        dependsOn: ["@browserbasehq/stagehand-v4-spike-server#build"],
      },
    },
  },
  pack: {
    entry: "src/index.ts",
    format: ["esm"],
    platform: "node",
    target: "node22",
    dts: {
      sourcemap: true,
    },
    sourcemap: true,
    outDir: "dist",
    copy: [
      {
        from: "../server/artifacts/stagehand-extension.zip",
        to: "dist/assets",
      },
      {
        from: "../server/dist",
        to: "dist",
        rename: "extension",
      },
    ],
    publint: true,
  },
});
