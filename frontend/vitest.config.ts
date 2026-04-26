import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./__tests__/setup.ts'],
    // legacy/ 는 quarantine — tsconfig/eslint 와 동일하게 vitest 도 exclude.
    exclude: ['**/node_modules/**', '**/dist/**', 'legacy/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
