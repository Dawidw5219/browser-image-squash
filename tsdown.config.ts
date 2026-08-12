import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "tsdown";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  minify: true,
  clean: true,
  hooks: {
    "build:done": () => {
      // dist/index.mjs ships a literal `new URL("./worker.ts", import.meta.url)`
      // (pass-through for consumer bundlers). Vite resolves it through the
      // module graph, but Parcel resolves the literal path against dist/, so
      // worker.ts — and every relative module it imports — must physically
      // exist alongside index.mjs.
      const workerDeps = [
        "core/worker.ts",
        "core/image-ops.ts",
        "core/raster-ops.ts",
      ];
      for (const rel of workerDeps) {
        copyFileSync(
          resolve(__dirname, "src", rel),
          resolve(__dirname, "dist", rel.replace(/^core\//, "")),
        );
      }
    },
  },
});
