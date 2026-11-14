import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { storagePackageAlias } from "../../scripts/storage-alias.mjs";

const webRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: storagePackageAlias(webRoot),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
