import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const proxy = { "/api": { target: process.env.ARCHDRIFT_API_URL ?? "http://localhost:8081", changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { allowedHosts: true, proxy },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "graph-engine": ["cytoscape"],
          "layout-engine": ["elkjs/lib/elk.bundled.js"],
        },
      },
    },
    chunkSizeWarningLimit: 1700, // elkjs is ~1.5 MB of transpiled Java
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
  },
});
