<script lang="ts">
  import { client } from './client.svelte.ts'
  import Panel from './Panel.svelte'

  // The agent's global stylesheet, after tapet's own.
  const style = document.createElement('style')
  style.dataset.tapet = 'global'
  document.head.append(style)

  $effect(() => {
    style.textContent = client.window.css ?? ''
  })
</script>

{#each client.panels as panel (panel.id)}
  <Panel {panel} />
{:else}
  <p class="tapet-empty">Waiting for the agent to add panels…</p>
{/each}
