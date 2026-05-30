import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendor splitting — keep react + router in their own small chunks
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'react';
          }
          if (id.includes('node_modules/react-router-dom') || id.includes('node_modules/react-router/')) {
            return 'router';
          }
          // xlsx and pdfjs are already lazy/dynamic — let Rollup auto-chunk them
          // Anthropic / AI SDK into its own chunk
          if (id.includes('node_modules/@anthropic-ai') || id.includes('node_modules/anthropic')) {
            return 'anthropic';
          }
        }
      }
    },
    // Don't inline small assets — keep requests cacheable
    assetsInlineLimit: 0,
  },
  define: {
    'import.meta.env.VITE_ANTHROPIC_KEY': JSON.stringify(process.env.VITE_ANTHROPIC_KEY || ''),
  },
  optimizeDeps: {
    // Pre-bundle these so dev server doesn't re-process on each request
    include: ['react', 'react-dom', 'react-router-dom'],
    // Exclude heavy libs that are only loaded dynamically
    exclude: ['xlsx', 'pdfjs-dist'],
  },
})
