// Renders markdown from LLMs and agents: code is highlighted, $…$ and $$…$$ become math, and
// ```mermaid blocks become diagrams. Their HTML is untrusted, so it's always sanitized.
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import 'katex/dist/katex.min.css'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import markedKatex from 'marked-katex-extension'

const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    // Returning the code unchanged leaves it to be escaped: mermaid source is drawn later.
    highlight: (code, language) =>
      hljs.getLanguage(language) && language !== 'mermaid'
        ? hljs.highlight(code, { language }).value
        : code,
  }),
  markedKatex({ throwOnError: false }),
)

const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
} as const

let diagrams = 0

// Style elements would restyle the whole window, not just the markdown.
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }), { FORBID_TAGS: ['style'] })
}

// Draws the mermaid blocks of rendered markdown in place. A block that fails keeps its source and
// gets the error under it. Returns the errors.
export async function renderDiagrams(root: HTMLElement): Promise<string[]> {
  const errors: string[] = []
  const blocks = root.querySelectorAll('pre > code.language-mermaid')
  if (blocks.length === 0) {
    return errors
  }

  // Mermaid is large, so it loads with the first diagram rather than with every window.
  const { default: mermaid } = await import('mermaid')
  // Diagrams take the theme the window has when they're drawn.
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  mermaid.initialize({ ...MERMAID_CONFIG, theme: dark ? 'dark' : 'default' })
  for (const code of blocks) {
    const block = code.parentElement
    if (!block) {
      continue
    }

    diagrams += 1
    try {
      const { svg } = await mermaid.render(`tapet-mermaid-${diagrams}`, code.textContent ?? '')
      const diagram = document.createElement('div')
      diagram.className = 'tapet-mermaid'
      diagram.innerHTML = svg
      block.replaceWith(diagram)
    } catch (error) {
      const message = `mermaid diagram: ${error instanceof Error ? error.message : String(error)}`
      const note = document.createElement('p')
      note.className = 'tapet-mermaid-error'
      note.textContent = message
      block.after(note)
      errors.push(message)
    }
  }

  return errors
}
