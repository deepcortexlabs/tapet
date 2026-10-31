// Renders markdown from LLMs and agents. Their HTML is untrusted, so it's always sanitized.
import DOMPurify from 'dompurify'
import { marked } from 'marked'

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }))
}
