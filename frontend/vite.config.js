import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/health": "http://127.0.0.1:8000",
      "/vehicles": "http://127.0.0.1:8000",
      "/challans": "http://127.0.0.1:8000",
      "/reviews": "http://127.0.0.1:8000",
      "/verify-evidence": "http://127.0.0.1:8000",
    },
  },
});