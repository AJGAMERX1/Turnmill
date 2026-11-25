import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  optimizeDeps: {
    include: ["replicad", "three/examples/jsm/libs/fflate.module.js"],
    exclude: ["@salusoft89/planegcs", "replicad-opencascadejs"],
  },
  build: { chunkSizeWarningLimit: 1300 },
});
