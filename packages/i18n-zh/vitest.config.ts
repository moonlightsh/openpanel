import { defineConfig } from 'vitest/config';

// 独立轻量配置：node 环境，不引用根 globalSetup / DB / 浏览器，纯逻辑单测。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,mts,mjs}'],
  },
});
