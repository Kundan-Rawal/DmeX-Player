import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0', // This MUST be 0.0.0.0
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));