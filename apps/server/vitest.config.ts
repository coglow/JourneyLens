import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testcontainers 启动 PostgreSQL 和迁移需要时间；超时只影响集成测试，不影响单元测试。
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
