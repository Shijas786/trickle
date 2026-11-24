import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Relative base so the build works from any path (GitHub Pages project sites).
// The Gno JS client expects Node's Buffer and crypto in the browser.
export default defineConfig({
  base: "./",
  plugins: [nodePolyfills({ include: ["buffer", "crypto", "stream", "util", "events", "process", "vm"] })],
  build: { target: "es2022" },
});
