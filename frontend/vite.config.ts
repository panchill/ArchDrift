import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
