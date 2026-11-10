/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const replitHosts = [
  process.env.REPLIT_DEV_DOMAIN,
  ...(process.env.REPLIT_DOMAINS || '').split(','),
].filter((host): host is string => Boolean(host))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    // Replit serves on a fixed 5000; locally that clashes with macOS AirPlay
    // Receiver, so default to Vite's 5173 and let it fall forward if busy.
    port: Number(process.env.VITE_PORT) || (replitHosts.length ? 5000 : 5173),
    allowedHosts: ['localhost', '127.0.0.1', ...replitHosts],
    strictPort: replitHosts.length > 0,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
  },
})
