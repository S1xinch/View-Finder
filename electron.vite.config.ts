import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

function getAppVersion(): string {
  try {
    return (JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
}

// Baked in at build/dev time so the running app can show exactly which
// commit it was built from — lets us confirm a bug report is actually
// against the latest code rather than a stale build.
const buildInfo = {
  __APP_VERSION__: JSON.stringify(getAppVersion()),
  __GIT_COMMIT__: JSON.stringify(getGitCommit())
}

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
    define: buildInfo,
    plugins: [react()]
  }
})
