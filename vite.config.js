import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // relative base so it works under any GitHub Pages sub-path
  base: "./",
  plugins: [react()],
  server: { host: true },
});
