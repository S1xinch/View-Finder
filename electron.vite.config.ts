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

// maplibre-gl's worker file (imported via `?url` in MapView.tsx - see the
// comment there for why) has its own hardcoded
// `import {...} from "./maplibre-gl-shared.mjs"` - a plain relative import
// to an exact, unhashed sibling file it expects to be sitting right next
// to it. Vite's `?url` import only copies the worker file itself
// byte-for-byte; it has no idea that file has its own further import to
// satisfy, so without this plugin the worker loads fine but then fails at
// runtime (`net::ERR_UNEXPECTED`) trying to fetch a sibling file that was
// never emitted. Dev mode never hits this: with maplibre-gl excluded from
// pre-bundling (see optimizeDeps below), Vite's dev server serves straight
// from node_modules/maplibre-gl/dist/, where both files already sit side
// by side. This plugin emits that one missing sibling, unhashed, into the
// same assets/ directory the worker chunk itself lands in for a real
// build.
function copyMaplibreSharedChunk() {
  return {
    name: 'copy-maplibre-gl-shared-chunk',
    generateBundle(this: { emitFile: (opts: { type: 'asset'; fileName: string; source: Buffer }) => void }) {
      this.emitFile({
        type: 'asset',
        fileName: 'assets/maplibre-gl-shared.mjs',
        source: readFileSync(resolve('node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs'))
      })
    }
  }
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
    },
    // `as any`: electron-vite@5's PreloadBuildOptions type is written
    // against Vite 6's BuildEnvironmentOptions, but this project has Vite
    // 5.4.21 installed (a devDependency version-skew issue, not a problem
    // with this config) - that type mismatch makes `tsc` reject an
    // otherwise valid rollupOptions.output block with an excess-property
    // error. The config below is plain, valid Vite/Rollup build config.
    build: {
      rollupOptions: {
        output: {
          // Force CommonJS with a .cjs extension rather than following
          // package.json's "type": "module" (which would emit .mjs).
          // Electron's preload script loader does not reliably treat .mjs
          // as an ES module - in testing it threw "Cannot use import
          // statement outside a module" trying to run it as CommonJS,
          // meaning contextBridge.exposeInMainWorld() never ran and
          // window.viewFinderAPI was silently undefined in the renderer.
          // CommonJS preload scripts are the universally-supported path
          // across Electron versions, so this sidesteps the issue entirely.
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    } as any
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
    plugins: [react(), copyMaplibreSharedChunk()]
  }
})
