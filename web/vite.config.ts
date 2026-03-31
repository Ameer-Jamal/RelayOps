import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@relayops/shared": path.resolve(__dirname, "../src/shared")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4317",
        changeOrigin: true
      },
      "/health": {
        target: "http://127.0.0.1:4317",
        changeOrigin: true
      }
    },
    fs: {
      allow: [path.resolve(__dirname, "..")]
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
