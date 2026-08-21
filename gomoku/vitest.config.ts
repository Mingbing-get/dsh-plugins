import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-runtime/client': fileURLToPath(
        new URL(
          '../../../test/deepseek-harness/packages/client/runtime/src/client/index.ts',
          import.meta.url,
        ),
      ),
    },
  },
})
