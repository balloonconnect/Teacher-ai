import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'], testTimeout: 30000, pool: 'forks',
    // `npm run coverage`: what the server tests actually execute. The React front end is checked by type-check, axe tests and browser runs, not unit coverage.
    coverage: { provider: 'v8', include: ['server/**/*.ts', 'shared/**/*.ts'], exclude: ['server/curriculum/**', 'server/index.ts'], reporter: ['text-summary', 'json-summary', 'html'] },
  },
});
