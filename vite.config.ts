import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const explicitHost = process.env.TAURI_DEV_HOST;
const host = explicitHost || "127.0.0.1";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host,
    hmr: explicitHost
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
