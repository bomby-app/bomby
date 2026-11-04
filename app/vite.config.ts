import path from "node:path"
import process from "node:process"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Set by `tauri dev` when the app runs on a device over the network (mobile); unset on desktop.
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/ and https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  // React Compiler memoizes components and hooks at build time, through Oxc's Rust port
  // (`oxc-transform-react`; docs/frontend-notes.md).
  plugins: [react({ compiler: true }), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  // One HTML page per window (src-tauri/src/windows.rs opens the others by file name).
  build: {
    // The pages load from disk inside the app, not over a network; livekit-client and the
    // transcript's markdown renderer make the main chunk about 1.4 MB.
    chunkSizeWarningLimit: 2000,
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
