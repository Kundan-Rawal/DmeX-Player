import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { internalIpV4 } from 'internal-ip';

const devHost = process.env.TAURI_DEV_HOST || await internalIpV4();

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0', 
    hmr: {
      protocol: 'ws',
      host: devHost,
      port: 1421,
    },
    watch: {
      usePolling: true,
      interval: 100, 
    }
  },
});
