import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Injected at build time — updates automatically on every Vercel deploy
    __BUILD_DATE__: JSON.stringify(
      new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
    ),
  },
})
