import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

function apiProxy(): ProxyOptions {
  return {
    target: process.env.API_URL ?? 'http://127.0.0.1:3000',
    changeOrigin: true,
    configure(proxy) {
      // The browser talks to Vite as a same-origin client. Do not forward Vite's
      // development origin to the API, whose CORS allow-list belongs to direct clients.
      proxy.on('proxyReq', (request) => request.removeHeader('origin'));
    },
  };
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy: { '/api': apiProxy() } },
  preview: { host: '0.0.0.0', port: 5174, strictPort: true, proxy: { '/api': apiProxy() } }
});
