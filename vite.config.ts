import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import Sitemap from "vite-plugin-sitemap";

const publicSitemapRoutes = ["/pricing", "/audit", "/login", "/signup", "/demo-live"];

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const useLovableTagger = mode === "development" && env.VITE_LOVABLE_TAGGER === "true";

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        // Show the Vite error overlay so a runtime error is not a silent blank page
        overlay: true,
      },
    },
    // lovable-tagger can break HMR; opt in via VITE_LOVABLE_TAGGER=true in .env
    plugins: [
      react(),
      useLovableTagger && componentTagger(),
      Sitemap({
        hostname: "https://margin6.com",
        dynamicRoutes: publicSitemapRoutes,
        generateRobotsTxt: false,
      }),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
