import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "vite-plus";
import { instrumentedDecoratorBuild } from "./instrumentedDecoratorBuild.ts";

const root = import.meta.dirname;
const outDir = path.join(root, "dist");

function copyExtensionStaticFiles() {
  return {
    name: "stagehand-extension-static-files",
    async closeBundle() {
      await mkdir(outDir, { recursive: true });
      await cp(path.join(root, "manifest.json"), path.join(outDir, "manifest.json"));
      await cp(
        path.join(root, "service-worker-lifecycle/wake.html"),
        path.join(outDir, "wake-service-worker.html"),
      );
      await mkdir(path.join(outDir, "offscreen"), { recursive: true });
      await cp(
        path.join(root, "service-worker-lifecycle/heartbeat.html"),
        path.join(outDir, "offscreen/service-worker-heartbeat.html"),
      );
    },
  };
}

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    modulePreload: false,
    outDir,
    target: "es2022",
    rolldownOptions: {
      input: {
        "service-worker": path.join(root, "service-worker.ts"),
        "offscreen/service-worker-heartbeat": path.join(
          root,
          "service-worker-lifecycle/heartbeat.ts",
        ),
        "wake-service-worker": path.join(root, "service-worker-lifecycle/wake.ts"),
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
  plugins: [instrumentedDecoratorBuild(), copyExtensionStaticFiles()],
});
