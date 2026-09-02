import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const API = process.env.HUDDLE_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  server: {
    // In development the app and the API run as two processes. In production
    // they are one origin, so nothing here has a production equivalent.
    proxy: {
      '/api': { target: API, changeOrigin: true, ws: true },
      '/auth': { target: API, changeOrigin: true },
    },
  },
});
