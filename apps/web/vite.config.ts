import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Production CSP as a meta tag (the API origin comes from VITE_API_BASE_URL, so it can only be
 * known at build time). Headers that a meta tag cannot carry (frame-ancestors, HSTS...) are in
 * public/_headers. Not applied in `vite dev`, whose hot reload needs an inline script.
 */
export function cspPlugin(apiBaseUrl: string): Plugin {
  const apiOrigin = (() => {
    try {
      return new URL(apiBaseUrl).origin;
    } catch {
      return '';
    }
  })();
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self' ${apiOrigin}`.trim(),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'fluvia-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return { plugins: [react(), cspPlugin(env.VITE_API_BASE_URL ?? '')] };
});
