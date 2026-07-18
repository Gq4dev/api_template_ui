/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Component tests (CreatePage) render Mantine + Router into a DOM.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Tests import modules that read import.meta.env.VITE_API_BASE_URL at load
    // time (api/config.ts now hard-fails when it is unset). Vitest runs in "test"
    // mode and does not load .env.development, so provide a harmless base URL here.
    env: {
      VITE_API_BASE_URL: 'http://localhost/api/v1/templates',
    },
  },
})
