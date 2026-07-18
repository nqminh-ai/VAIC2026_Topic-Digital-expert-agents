import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: '../',
  server: {
    allowedHosts: ["frontend-production-cb3f5.up.railway.app"],
  }
})
