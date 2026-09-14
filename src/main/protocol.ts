import { join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'

// The packaged renderer is served under this scheme instead of via
// window.loadFile()'s plain file:// protocol. Chromium treats file:// as a
// restricted, non-standard origin - most concretely, it blocks loading the
// ES module Web Worker maplibre-gl's own worker bundle uses, so the map's
// worker silently failed to start once packaged (loadFile/file://), despite
// working fine in dev (window.loadURL against Vite's http:// dev server).
// Registering "app" as a privileged, secure, fetch-capable scheme gives the
// packaged renderer the same http-like origin semantics dev mode already
// had, so nothing else that depends on "a real origin" (workers now, and
// anything else added later) needs special-casing for file://.
export const APP_SCHEME = 'app'
const RENDERER_HOST = 'bundle'

// Must run before app.whenReady() - registerSchemesAsPrivileged only has an
// effect if called during module initialization.
export function registerAppSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    }
  ])
}

export function appUrl(path = 'index.html'): string {
  return `${APP_SCHEME}://${RENDERER_HOST}/${path}`
}

// Must run after app.whenReady() (protocol.handle isn't available before).
// rendererDir is the built out/renderer directory - net.fetch() on a
// file:// URL transparently handles asar-packed paths the same way Node's
// fs does, so this works unmodified whether running unpacked (dev/local
// build) or from inside app.asar (a real packaged install).
export function registerAppProtocolHandler(rendererDir: string): void {
  const root = normalize(rendererDir)

  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url)
    const relativePath = pathname === '/' || pathname === '' ? 'index.html' : decodeURIComponent(pathname.slice(1))
    const filePath = normalize(join(root, relativePath))

    // Defensive path-traversal guard - nothing in this app currently
    // constructs an app:// URL from untrusted input, but a resource
    // request handler serving arbitrary files from disk should never trust
    // the request path without checking it stays inside its own root.
    if (!filePath.startsWith(root)) {
      return new Response('Forbidden', { status: 403 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}
