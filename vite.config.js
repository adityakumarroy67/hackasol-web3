// Website build/dev settings. The site lives in app/. In Docker, the dev server forwards
// /rpc to the local blockchain and /ipfs-api + /ipfs to the local IPFS node.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const IPFS_API = process.env.IPFS_API ?? "http://127.0.0.1:5001";
const IPFS_GATEWAY = process.env.IPFS_GATEWAY ?? "http://127.0.0.1:8080";
const LOCAL_RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8545";

// The IPFS API refuses requests that look like they come from a browser (a CSRF protection).
// Only our own page talks to this local node through the proxy, so the proxy drops those headers.
const BROWSER_HEADERS = ["origin", "referer", "user-agent", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform"];
const dropOrigin = (proxy) => proxy.on("proxyReq", (req) => BROWSER_HEADERS.forEach((h) => req.removeHeader(h)));

export default defineConfig({
  root: "app",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: {
    port: 5173,
    watch: { usePolling: true, interval: 300 }, // see file edits made on Windows from inside Docker
    proxy: {
      "/rpc": { target: LOCAL_RPC, changeOrigin: true, rewrite: () => "/" },
      "/ipfs-api": { target: IPFS_API, changeOrigin: true, rewrite: (p) => p.replace(/^\/ipfs-api/, ""), configure: dropOrigin },
      "/ipfs/": { target: IPFS_GATEWAY, changeOrigin: true },
    },
  },
});
