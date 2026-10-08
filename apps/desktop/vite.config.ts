// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Shell build. Port 1420 is build.devUrl in src-tauri/tauri.conf.json (origins.rs SHELL_DEV_ORIGIN).
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // LICENSE texts are imported from the repo root for the About screen (GEN-007).
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
