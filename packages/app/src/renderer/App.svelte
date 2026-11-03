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

  function endedTime(at: number): string {
    return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
</script>

<!-- Outside #tapet's layout flow, so it never moves the agent's panels. -->
{#if client.state === 'detached'}
  <p class="tapet-session-status" data-state="detached">No agent attached</p>
{:else if client.state === 'ended'}
  <p class="tapet-session-status" data-state="ended">
    Session ended{client.endedAt === undefined ? '' : ` at ${endedTime(client.endedAt)}`}
  </p>
{/if}

{#each client.panels as panel (panel.id)}
  <Panel {panel} />
{:else}
  <p class="tapet-empty">Waiting for the agent to add panels…</p>
{/each}
