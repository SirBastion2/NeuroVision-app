import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { storagePackageAlias } from "../../scripts/storage-alias.mjs";

const webRoot = dirname(fileURLToPath(import.meta.url));

function dataPng(file: string) {
  return `data:image/png;base64,${readFileSync(join(webRoot, "public", file)).toString("base64")}`;
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "inline-favicons",
      transformIndexHtml(html) {
        return html
          .replaceAll("/favicon-32.png", dataPng("favicon-32.png"))
          .replaceAll("/favicon-180.png", dataPng("favicon-180.png"));
      },
    },
    viteSingleFile(),
  ],
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
