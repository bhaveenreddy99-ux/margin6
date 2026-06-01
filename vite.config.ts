import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import Sitemap from "vite-plugin-sitemap";

const publicSitemapRoutes = ["/pricing", "/audit", "/login", "/signup", "/demo-live"];

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      // Show the Vite error overlay so a runtime error is not a silent blank page
      overlay: true,
    },
  },
  plugins: [
    react(),
    Sitemap({
      hostname: "https://margin6.com",
      dynamicRoutes: publicSitemapRoutes,
      generateRobotsTxt: false,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-ui": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-popover",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast",
          ],
          "vendor-charts": ["recharts"],
          "vendor-pdf": ["jspdf", "html2canvas"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
