import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
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

// Same __APP_VERSION__/__GIT_COMMIT__ globals electron.vite.config.ts
// injects for the desktop app, so VersionBadge.tsx (reused unmodified
// from src/renderer/) works identically on the website.
const buildInfo = {
  __APP_VERSION__: JSON.stringify(getAppVersion()),
  __GIT_COMMIT__: JSON.stringify(getGitCommit())
}

// Same fix as electron.vite.config.ts's renderer config, for the same
// reason: maplibre-gl's worker file (imported via `?url` in
// src/renderer/map/MapView.tsx) has its own hardcoded
// `import {...} from "./maplibre-gl-shared.mjs"` - a plain relative
// import to an exact, unhashed sibling file it expects to be sitting
// right next to it. Vite's `?url` import only copies the worker file
// itself byte-for-byte, so without this the worker loads but then fails
// at runtime trying to fetch a sibling file that was never emitted. See
// electron.vite.config.ts's copy of this same plugin for the full
// explanation.
function copyMaplibreSharedChunk(): Plugin {
  return {
    name: 'copy-maplibre-gl-shared-chunk',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'assets/maplibre-gl-shared.mjs',
        source: readFileSync(resolve('node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs'))
      })
    }
  }
}

export default defineConfig({
  root: 'src/site',
  // GitHub Pages serves a project site from a subpath
  // (https://<owner>.github.io/<repo>/), not the domain root - relative
  // asset paths work correctly under any subpath (or at a domain root,
  // for a custom-domain deployment) without hardcoding the repo name.
  base: './',
  publicDir: resolve('build'),
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@renderer': resolve('src/renderer'),
      '@shared': resolve('src/shared')
    }
  },
  optimizeDeps: {
    exclude: ['maplibre-gl']
  },
  worker: {
    format: 'es'
  },
  define: buildInfo,
  plugins: [react(), copyMaplibreSharedChunk()],
  build: {
    outDir: resolve('dist-site'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Splits the two largest, rarely-changing vendor deps into their
        // own chunks so a normal app-code change doesn't force visitors to
        // re-download all of react/react-dom/maplibre-gl too - those chunks
        // stay cached across deploys that don't touch them.
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-maplibre': ['maplibre-gl']
        }
      }
    }
  }
})
