import { defineConfig } from '@playwright/test'

// End-to-end tests drive the real app through MCP, the way an agent does. They need a built app:
// `pnpm test:e2e` builds it first.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'line',
})
