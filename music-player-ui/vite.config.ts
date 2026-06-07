import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { internalIpV4 } from 'internal-ip';

// Replace this with your exact IPv4 address from running 'ipconfig' in cmd
const myIP = "192.168.1.11"; 

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0', 
    hmr: {
      protocol: 'ws',
      host: await internalIpV4(),
      port: 1421,
    },
    watch: {
      usePolling: true,
      interval: 100, 
    }
  },
});