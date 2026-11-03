// Reads a Claude Code session and prints what a gallery example needs from it:
// its first prompt and its date.
// Usage: node site/session.ts <session-id>
import { glob, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface Entry {
  type?: string
  isMeta?: boolean
  timestamp?: string
  message?: {
    content?: string | { type: string; text?: string }[]
  }
}

const sessionId = process.argv[2]
if (!sessionId || !/^[\w-]+$/.test(sessionId)) {
  console.error('Usage: node site/session.ts <session-id>')
  process.exit(1)
}

const projects = join(homedir(), '.claude', 'projects')
const [sessionFile] = await Array.fromAsync(glob(`*/${sessionId}.jsonl`, { cwd: projects }))
if (!sessionFile) {
  console.error(`No session ${sessionId} in ${projects}`)
  process.exit(1)
}

const transcript = join(projects, sessionFile)
const entries: Entry[] = (await readFile(transcript, 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))

function promptText(entry: Entry) {
  const content = entry.message?.content
  if (typeof content === 'string') return content
  return (content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

// The first real prompt: not a tool result, not injected context and not a slash command's wrapper.
const isPrompt = (entry: Entry) => {
  if (entry.type !== 'user' || entry.isMeta) return false
  const text = promptText(entry).trim()
  return text !== '' && !text.startsWith('<')
}

const prompt = entries.find(isPrompt)
if (!prompt) {
  console.error(`Session ${sessionId} has no prompt`)
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      prompt: promptText(prompt).trim(),
      date: prompt.timestamp?.slice(0, 10),
      transcript,
    },
    null,
    2,
  ),
)
