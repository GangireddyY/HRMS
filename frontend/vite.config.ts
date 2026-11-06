/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite';

export default defineConfig(({ mode }) => {
  // Reads frontend/.env, .env.<mode> (all keys, including non-VITE_ dev-server settings).
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  const port = Number(env.DEV_SERVER_PORT || 5173);
  const proxy = { '/api': { target: env.DEV_API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: false } };
  const contractsDir = fileURLToPath(new URL('../backend/src/contracts', import.meta.url));

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@contracts': `${contractsDir}/index.ts`,
      },
    },
    // The dev server only serves files inside frontend/ by default; the contracts live in backend/.
    server: { port, strictPort: true, proxy, fs: { allow: [searchForWorkspaceRoot(process.cwd()), contractsDir] } },
    preview: { port: 4173, proxy },
    build: {
      sourcemap: true,
      chunkSizeWarningLimit: 900,
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.spec.ts'],
      restoreMocks: true,
    },
  };
});
