import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // На dev-сервере фронтенд ходит на бэкенд через прокси,
    // чтобы в коде апи сохранились относительные пути (/shorten и т.д.).
    proxy: {
      '/shorten': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/links': 'http://localhost:3000',
    },
  },
})