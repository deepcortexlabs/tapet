import { NETWORK_HOSTS } from '@tapet/core'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'electron-vite'

// The window's content security policy lets it load only from tapet's allowed hosts.
const network = NETWORK_HOSTS.map((host) => `https://${host}`).join(' ')

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
  renderer: {
    // Workers are ES modules, the way MapLibre starts its own.
    worker: { format: 'es' },
    plugins: [
      svelte(),
      {
        name: 'tapet-network-hosts',
        transformIndexHtml: (html: string) => html.replaceAll('%TAPET_NETWORK_HOSTS%', network),
      },
    ],
  },
})
