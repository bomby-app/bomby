import path from "node:path"
import process from "node:process"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Set by `tauri dev` when the app runs on a device over the network (mobile); unset on desktop.
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/ and https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  // One HTML page per window (src-tauri/src/windows.rs opens the others by file name).
  build: {
    rolldownOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        settings: path.resolve(import.meta.dirname, "settings.html"),
      },
    },
  },
  // Keep Rust errors visible in the terminal.
  clearScreen: false,
  server: {
    // Tauri loads devUrl (tauri.conf.json), so the port is fixed.
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
})
