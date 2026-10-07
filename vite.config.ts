import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const explicitHost = process.env.TAURI_DEV_HOST;
const host = explicitHost || "127.0.0.1";
const devPort = Number(process.env.TAURI_DEV_PORT || "1420");
const hmrPort = Number(
  process.env.TAURI_DEV_HMR_PORT || String(devPort + 1),
);

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: devPort,
    strictPort: true,
    host,
    hmr: explicitHost
      ? {
          protocol: "ws",
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
