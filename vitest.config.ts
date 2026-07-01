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
    // Several suites boot real HTTP servers (static server, preview proxy,
    // run_app probe, full Session). Running files in parallel makes them
    // contend for ports/resources and flake; the suite is small, so run files
    // sequentially for reliability.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      // json-summary feeds the CI "coverage" step that prints the four
      // categories (statements/branches/functions/lines); html for local drill-down.
      reporter: ['text', 'text-summary', 'json', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      // Scope: the packages with unit tests (server logic + shared types).
      // web/src (React UI) and cli/src (thin launcher) are intentionally
      // excluded — they have no unit-test harness, so including them would
      // report ~0% and drag the total down without signalling a real gap. Add
      // a package here once it has tests.
      include: ['packages/server/src/**', 'packages/shared/src/**'],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        // LLM-driven agent loops — their real coverage is the subscription e2e
        // (scripts/check-claude-engine.ts), not unit tests. Counting them here
        // would require mocking the model and just depress the number for code
        // that IS verified end-to-end. (Same rationale hivemind uses to exclude
        // its subprocess/entry-point files.)
        'packages/server/src/agent/claude/engine.ts',
        'packages/server/src/agent/runtime.ts',
        'packages/server/src/agent/orchestrator.ts',
      ],
      // Per-file thresholds on the well-tested new modules — like hivemind, the
      // gate grows as PRs add their files here, rather than a global average
      // that hides regressions in new code. I/O-heavy files (engine query loop,
      // session, runner, probe) are covered by the real-subscription e2e
      // (scripts/check-claude-engine.ts), which isn't part of this unit coverage.
      thresholds: {
        'packages/server/src/agent/claude/roles.ts': { statements: 90, branches: 80, functions: 90, lines: 90 },
        'packages/server/src/agent/claude/map-messages.ts': { statements: 85, branches: 80, functions: 90, lines: 85 },
        'packages/server/src/providers/claude.ts': { statements: 90, branches: 80, functions: 90, lines: 90 },
        'packages/server/src/runner.ts': { statements: 78, branches: 70, functions: 75, lines: 78 },
      },
    },
  },
});
