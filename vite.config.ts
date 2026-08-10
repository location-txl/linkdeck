import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: 'index.html',
        'service-worker': 'src/service-worker.ts',
      },
      output: {
        entryFileNames: 'assets/[name].js',
      },
    },
  },
})
