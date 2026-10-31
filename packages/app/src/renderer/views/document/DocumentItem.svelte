<script lang="ts">
  import type { Entry } from '@tapet/core'
  import DOMPurify from 'dompurify'
  import { renderDiagrams, renderMarkdown } from '../../markdown.ts'
  import { imageType, toBytes, toText, type DocumentContent } from './document-model.ts'

  let {
    entry,
    content,
    report,
  }: { entry: Entry; content: DocumentContent; report: (message: string) => void } = $props()

  const bytes = $derived(toBytes(entry.value))
  const text = $derived(content === 'image' ? '' : toText(bytes))

  // An image lives in a blob URL for as long as it's shown.
  function image(element: HTMLImageElement) {
    const url = URL.createObjectURL(new Blob([bytes], { type: imageType(bytes) }))
    element.src = url
    return () => URL.revokeObjectURL(url)
  }

  // HTML documents get a shadow root, so their own <style> elements style only the document.
  function html(element: HTMLElement) {
    const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' })
    root.innerHTML = DOMPurify.sanitize(text, { WHOLE_DOCUMENT: true })
  }

  function markdown(element: HTMLElement) {
    element.innerHTML = renderMarkdown(text)
    void renderDiagrams(element).then((errors) => {
      for (const error of errors) {
        report(error)
      }
    })
  }
</script>

<article class="tapet-document-item" data-content={content}>
  {#if content === 'image'}
    <img class="tapet-document-image" alt="" {@attach image} />
  {:else if content === 'text'}
    <pre class="tapet-document-text">{text}</pre>
  {:else if content === 'html'}
    <div class="tapet-document-html" {@attach html}></div>
  {:else}
    <div class="tapet-document-markdown" {@attach markdown}></div>
  {/if}
</article>
