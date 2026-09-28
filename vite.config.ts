import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    // Honour PORT so a supervising tool can place the dev server on a free
    // port instead of Vite silently picking the next one up.
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    // ag-grid, recharts and SheetJS are the bulk of the bundle and none of them
    // are needed to paint the upload screen, so they get their own chunks.
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'ag-grid', test: /node_modules[\\/]ag-grid/ },
            { name: 'charts', test: /node_modules[\\/](recharts|d3-|victory-|decimal\.js)/ },
            { name: 'xlsx', test: /node_modules[\\/]xlsx/ },
          ],
        },
      },
    },
  },
})
