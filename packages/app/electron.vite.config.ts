import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  // Bundle everything (workspace packages are TypeScript sources), so out/ is self-contained.
  main: { build: { externalizeDeps: false } },
  // Sandboxed windows only accept CommonJS preload scripts.
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: { plugins: [svelte()] },
})
