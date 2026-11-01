import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NETWORK_HOSTS } from '@tapet/core'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'electron-vite'
import { transformWithOxc } from 'vite'

// The window's content security policy lets it load only from tapet's allowed hosts.
const network = NETWORK_HOSTS.map((host) => `https://${host}`).join(' ')
const renderer = join(import.meta.dirname, 'src', 'renderer')

// A custom view's frame has no origin, so it can't load scripts from tapet's files: its bootstrap
// is compiled and inlined into custom.html.
async function frameScript(): Promise<string> {
  const path = join(renderer, 'custom', 'frame.ts')
  const { code } = await transformWithOxc(readFileSync(path, 'utf8'), path)
  return `<script>${code}</script>`
}

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
    build: {
      rolldownOptions: {
        input: { index: join(renderer, 'index.html'), custom: join(renderer, 'custom.html') },
      },
    },
    plugins: [
      svelte(),
      {
        name: 'tapet-pages',
        transformIndexHtml: async (html: string) =>
          html
            .replaceAll('%TAPET_NETWORK_HOSTS%', network)
            .replace(
              '<!-- tapet:frame -->',
              html.includes('<!-- tapet:frame -->') ? await frameScript() : '',
            ),
      },
    ],
  },
})
