import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/uploads": "http://localhost:8000",
      "/voices": "http://localhost:8000",
      "/output": "http://localhost:8000",
      "/comfy_input": "http://localhost:8000",
    },
  },
});
