import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // `.tsx` too: some logic worth pinning lives beside the components that
    // use it, and a formatting function that can throw is worth a test.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  // The components use the automatic JSX runtime, so a test that imports one
  // needs the same transform rather than a React global.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
