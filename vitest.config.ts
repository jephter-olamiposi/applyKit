import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/__tests__/**/*.test.ts',
      'apps/*/src/**/__tests__/**/*.test.ts',
      'packages/*/src/**/__tests__/**/*.test.tsx',
      'apps/*/src/**/__tests__/**/*.test.tsx',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
