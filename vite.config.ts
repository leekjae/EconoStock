import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

function resolveBasePath() {
  const explicitBase = process.env.VITE_BASE_PATH?.trim();
  if (explicitBase) {
    if (explicitBase === "/") {
      return "/";
    }
    return explicitBase.endsWith("/") ? explicitBase : `${explicitBase}/`;
  }

  const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
  if (process.env.GITHUB_ACTIONS === "true" && repoName) {
    return `/${repoName}/`;
  }

  return "/";
}

export default defineConfig(() => ({
  base: resolveBasePath(),
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
