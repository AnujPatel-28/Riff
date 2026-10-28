import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Studio reuses the extension's own code (extract, format, GitHub save) from
// ../extension/lib, so the live demo and the extension cannot drift apart.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [".."] } },
  build: { target: "es2022" },
});
