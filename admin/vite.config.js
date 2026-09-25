import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 5300: clear of the world (5331), the site copy (5290) and the live site
  // (5280), so all four can run at once.
  server: { port: 5300, strictPort: true, host: true }
})
