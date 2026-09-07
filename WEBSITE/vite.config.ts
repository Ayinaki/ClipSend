import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  // GitHub Pages serves the site from a repo subpath (/ClipSend/), not the domain root.
  // Without this, /icon.svg and friends 404. Override locally with --base=/ if ever needed.
  base: process.env.VITE_BASE || "/ClipSend/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
