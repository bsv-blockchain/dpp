import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// In development Vite serves the pages and proxies to the API what the API
// answers itself: /api, and the identifier host's paths, which are every path
// under /01, the resolver description and a compressed identifier
// (apps/api/src/resolver.ts). Vite answers an OPTIONS request itself, before
// its proxy. In production the API serves the built pages itself
// (apps/web/dist).
const api = { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': api, '^/01(/|\\?|$)': api, '^/\\.well-known/gs1resolver/?(\\?|$)': api, '^/e[hx][A-Za-z0-9_-]{16,}/?(\\?|$)': api },
  },
})
