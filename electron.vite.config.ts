import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // ptyHost is its own detached process, not imported by index; boot
        // picks the installed or the live build of index (liveState.ts).
        input: {
          boot: "src/main/boot.ts",
          index: "src/main/index.ts",
          ptyHost: "src/main/ptyHost.ts",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
});
