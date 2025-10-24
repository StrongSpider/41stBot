import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: path.resolve(__dirname, 'website'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'website')
    }
  },
  server: {
    middlewareMode: true,
    host: true,                    // allow any host header 
    fs: {
      allow: [path.resolve(__dirname)]
    },
    allowedHosts: true
  }
})