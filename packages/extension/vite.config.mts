import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Plugin to copy manifest.json and icons into the build output.
 */
function copyStaticAssets(): Plugin {
  return {
    name: "copy-static-assets",
    generateBundle() {
      // Copy manifest.json
      const manifest = readFileSync(
        resolve(__dirname, "manifest.json"),
        "utf-8"
      );
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: manifest,
      });

      // Copy icons
      const iconsDir = resolve(__dirname, "icons");
      if (existsSync(iconsDir)) {
        for (const file of readdirSync(iconsDir)) {
          if (file.endsWith(".png")) {
            const data = readFileSync(resolve(iconsDir, file));
            this.emitFile({
              type: "asset",
              fileName: `icons/${file}`,
              source: data,
            });
          }
        }
      }

      // Copy sidepanel.html
      const sidepanelHtml = readFileSync(
        resolve(__dirname, "public/sidepanel.html"),
        "utf-8"
      );
      this.emitFile({
        type: "asset",
        fileName: "sidepanel.html",
        source: sidepanelHtml,
      });
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        sidepanel: resolve(__dirname, "src/sidepanel.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
        format: "es",
      },
    },
  },
  publicDir: false,
  plugins: [copyStaticAssets()],
});
