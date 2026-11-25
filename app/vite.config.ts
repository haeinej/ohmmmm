import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Resolve the vault renderer's bare imports from the app, including in an app-only install.
    dedupe: ["yjs", "react", "react-dom", "markdown-it", "markdown-it-footnote"],
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
})
