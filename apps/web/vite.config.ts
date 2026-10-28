import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The favicon lives in public/, which the single-file build does not inline; embed it as a data URI.
const inlineFavicon = {
  name: 'inline-favicon',
  transformIndexHtml(html: string) {
    const svg = readFileSync(fileURLToPath(new URL('./public/favicon.svg', import.meta.url)), 'utf8');
    return html.replace(/\.?\/favicon\.svg/g, 'data:image/svg+xml,' + encodeURIComponent(svg));
  },
};

// `vite build --mode demo` produces dist-demo/index.html: one file with the sample reports and all locales inlined.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    plugins: [react(), ...(demo ? [inlineFavicon, viteSingleFile()] : [])],
    ...(demo ? {
      base: './',
      build: { outDir: 'dist-demo', emptyOutDir: true, copyPublicDir: false },
      resolve: { alias: [{ find: /^\.\/resources\.js$/, replacement: fileURLToPath(new URL('./src/shared/i18n/resources.demo.ts', import.meta.url)) }] },
    } : {}),
    server: { port: 5173, proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true } } },
    preview: { host: '0.0.0.0', port: 5173, proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true } } },
  };
});
