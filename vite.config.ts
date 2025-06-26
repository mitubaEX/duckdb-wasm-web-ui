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
    rollupOptions: {
      output: {
        manualChunks: {
          duckdb: ['@duckdb/duckdb-wasm']
        }
      }
    }
  }
})