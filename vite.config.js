import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    allowedHosts: ['.localhost'],
    watch: { usePolling: true, interval: 300 },
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 3001}`, changeOrigin: false },
      '/uploads': {
        target: `http://127.0.0.1:${process.env.API_PORT || 3001}`,
        changeOrigin: false,
      },
    },
  },
});
