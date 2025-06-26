import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm']
  },
  worker: {
    format: 'es'
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    fs: {
      allow: ['..']
    }
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: {
          duckdb: ['@duckdb/duckdb-wasm']
        },
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split('.')
          const ext = info[info.length - 1]
          if (/\.(wasm)$/.test(assetInfo.name)) {
            return `assets/[name]-[hash].${ext}`
          }
          if (/\.(js|ts)$/.test(assetInfo.name)) {
            return `assets/[name]-[hash].js`
          }
          return `assets/[name]-[hash].${ext}`
        },
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js'
      }
    }
  },
  define: {
    global: 'globalThis'
  }
})