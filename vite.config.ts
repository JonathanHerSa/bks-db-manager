import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import bks from '@beekeeperstudio/vite-plugin'

export default defineConfig({
  plugins: [vue(), tailwindcss(), bks()],
  server: {
    port: 5173,
    strictPort: true
  }
})
