// Deliberately standalone: the app's vite.config.ts loads the Cloudflare and
// TanStack Start plugins, which a plain node unit test neither needs nor can
// boot. Keep this config to framework-free reducer/selector tests.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
