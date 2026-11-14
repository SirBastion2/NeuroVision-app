import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { storagePackageAlias } from "../../scripts/storage-alias.mjs";

const webRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  publicDir: false,
  resolve: {
    alias: storagePackageAlias(webRoot, { forceUnavailable: true }),
  },
  define: {
    "import.meta.env.VITE_STANDALONE": JSON.stringify("true"),
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(""),
  },
  build: {
    outDir: "dist/standalone",
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
  },
});
