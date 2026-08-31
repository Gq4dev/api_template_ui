/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite does not put env vars on process.env for the config itself, so these
  // have to be read explicitly. The third arg "" loads EVERY key, not just the
  // VITE_-prefixed ones — which is the point: anything named VITE_* is inlined
  // into the client bundle, and neither of the settings below belongs there.
  const env = loadEnv(mode, process.cwd(), '')

  /**
   * Develop against a REMOTE api-template without touching its CORS policy.
   *
   * CORS is enforced by the browser against the SERVER's response headers, so an
   * API that does not list this origin in CORS_ALLOWED_ORIGINS cannot be reached
   * from a browser at all — no frontend setting changes that. The hosted
   * deployment goes further: it sits behind a Traefik ingress that answers the
   * preflight with a bare 404 and challenges with `WWW-Authenticate: Basic`,
   * either of which alone is fatal to a cross-origin fetch.
   *
   * This proxy sidesteps both. The browser talks to this dev server (same
   * origin, nothing for CORS to block) and Node forwards the request, adding the
   * Basic credentials on the way out.
   *
   * In .env.development — which is gitignored, and is the ONLY place the
   * credentials should ever live:
   *
   *   API_PROXY_TARGET=https://templates.178.104.93.97.nip.io
   *   API_PROXY_AUTH=user:password
   *   VITE_API_BASE_URL=/api/v1/templates
   *
   * VITE_API_BASE_URL must be RELATIVE. Left absolute, the browser goes
   * cross-origin again and the proxy is bypassed entirely.
   *
   * Leave API_PROXY_TARGET unset to talk to a local backend directly.
   *
   * Dev only. A deployed UI has a real origin and no proxy, so that origin must
   * be added to the API's CORS_ALLOWED_ORIGINS (and given a way through the
   * ingress) before it can work in production.
   */
  const proxyTarget = env.API_PROXY_TARGET
  const proxyAuth = env.API_PROXY_AUTH

  return {
    plugins: [react()],

    server: proxyTarget
      ? {
          proxy: {
            '/api': {
              target: proxyTarget,
              // Rewrites the Host header to the target's. Hosted backends behind
              // virtual hosting or TLS/SNI reject or misroute a request that
              // still claims to be for localhost.
              changeOrigin: true,
              configure: (proxy) => {
                if (proxyAuth) {
                  const encoded = Buffer.from(proxyAuth).toString('base64')
                  proxy.on('proxyReq', (proxyReq) => {
                    proxyReq.setHeader('Authorization', `Basic ${encoded}`)
                  })
                }
                // Surfaced deliberately: a proxy that fails silently looks
                // exactly like an API returning nothing, and that is a long
                // afternoon.
                proxy.on('error', (err) => {
                  console.error(`[api proxy] ${proxyTarget} -> ${err.message}`)
                })
                // A 401 here means the credentials, not the app. Without this
                // the UI just shows "could not load" and points you at the code.
                proxy.on('proxyRes', (proxyRes, req) => {
                  if (proxyRes.statusCode === 401) {
                    console.error(
                      `[api proxy] 401 from ${proxyTarget}${req.url} — ` +
                        (proxyAuth
                          ? 'API_PROXY_AUTH was rejected.'
                          : 'this API needs Basic auth; set API_PROXY_AUTH=user:password.'),
                    )
                  }
                })
              },
            },
          },
        }
      : undefined,

    test: {
      // Fail the run if any `.only` is left in a test file (guards against an
      // accidentally committed focused test silently skipping the rest). Vitest
      // spells this as `allowOnly: false` (there is no `forbidOnly` option).
      allowOnly: false,
      // Component tests (CreatePage) render Mantine + Router into a DOM.
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // Tests import modules that read import.meta.env.VITE_API_BASE_URL at load
      // time (api/config.ts now hard-fails when it is unset). Vitest runs in
      // "test" mode and does not load .env.development, so provide a harmless
      // base URL here.
      env: {
        VITE_API_BASE_URL: 'http://localhost/api/v1/templates',
      },
    },
  }
})
