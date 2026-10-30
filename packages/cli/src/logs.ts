import { readFile } from 'node:fs/promises'
import { sessionLogPath } from '@tapet/protocol'

export async function printLogs(session: string): Promise<number> {
  try {
    process.stdout.write(await readFile(sessionLogPath(session), 'utf8'))
    return 0
  } catch (error) {
    process.stderr.write(`tapet: no logs for session "${session}" (${String(error)})\n`)
    return 1
  }
}
