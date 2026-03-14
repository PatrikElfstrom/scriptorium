import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

function getBasePath() {
  if (process.env.GITHUB_PAGES !== "true") {
    return "/"
  }

  const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1]

  if (!repositoryName || repositoryName.endsWith(".github.io")) {
    return "/"
  }

  return `/${repositoryName}/`
}

export default defineConfig({
  base: getBasePath(),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
