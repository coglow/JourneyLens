import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/health': 'http://localhost:3001',
      '/api': { target: 'http://localhost:3001', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // 编排页和模拟面板要渲染完整的 antd 组件树，单个用例常超过默认的 5 秒。
    testTimeout: 15_000,
  },
});
