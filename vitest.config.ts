import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    // Determinism is a product requirement, not a test convenience: a flaky ordering here
    // means a non-deterministic plan there.
    sequence: { shuffle: false },
    coverage: { provider: 'v8', include: ['packages/*/src/**'], exclude: ['**/*.test.ts'] },
  },
});
