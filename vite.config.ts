import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Deployed to GitHub Pages at /watermarker/. Override via VITE_BASE for
  // other deploys.
  base: process.env.VITE_BASE ?? '/watermarker/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
})
