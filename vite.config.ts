import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[/\\]three[/\\]/.test(id)) return 'three-vendor';
        },
      },
    },
  },
});
