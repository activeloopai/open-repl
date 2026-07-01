import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@openrepl/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // json-summary feeds the CI "coverage" step that prints the four
      // categories (statements/branches/functions/lines); html for local drill-down.
      reporter: ['text', 'text-summary', 'json', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['packages/server/src/**', 'packages/shared/src/**'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      // Per-file thresholds on the well-tested new modules — like hivemind, the
      // gate grows as PRs add their files here, rather than a global average
      // that hides regressions in new code. I/O-heavy files (engine query loop,
      // session, runner, probe) are covered by the real-subscription e2e
      // (scripts/check-claude-engine.ts), which isn't part of this unit coverage.
      thresholds: {
        'packages/server/src/agent/claude/roles.ts': { statements: 90, branches: 80, functions: 90, lines: 90 },
        'packages/server/src/agent/claude/map-messages.ts': { statements: 85, branches: 80, functions: 90, lines: 85 },
      },
    },
  },
});
