import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:11325",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyRequest, request) => {
            if (request.headers.origin === "http://127.0.0.1:5173") {
              proxyRequest.setHeader("Origin", "http://127.0.0.1:11325");
            }
          });
        },
      },
    },
  },
  build: { outDir: "dist" },
});
