import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

function apiProxy(): ProxyOptions {
  return {
    target: process.env.API_URL ?? 'http://127.0.0.1:5173',
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (request, incoming) => {
        // Vite is the browser's origin in development. Preserve any other
        // Origin for the upstream to validate.
        if (incoming.headers.origin === `http://${incoming.headers.host}`) request.removeHeader('origin');
      });
    },
  };
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy: { '/api': apiProxy() } },
  preview: { host: '0.0.0.0', port: 5174, strictPort: true, proxy: { '/api': apiProxy() } }
});
