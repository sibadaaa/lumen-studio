import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const bff = "http://0.0.0.0:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": { target: bff, changeOrigin: false },
      "/media": { target: bff, changeOrigin: false },
    },
  },
});
