import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    // maplibre-gl ships a worker file that Vite's esbuild-based dep
    // optimizer doesn't pre-bundle correctly, causing a
    // ".vite/deps/maplibre-gl-worker.mjs does not exist" error at runtime.
    optimizeDeps: {
      exclude: ['maplibre-gl']
    },
    worker: {
      format: 'es'
    },
    plugins: [react()]
  }
})
