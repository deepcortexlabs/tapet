import { request } from 'node:http'
import { commandLine, selfCommand } from './paths.ts'

// `tapet -c <address>`: streams stdin into a panel's channel. Prints nothing on success.
export async function runPipe(
  address: string,
  options: { ignoreMalformed: boolean },
): Promise<number> {
  const url = new URL(`http://${address}`)
  if (options.ignoreMalformed) {
    url.searchParams.set('ignoreMalformed', '1')
  }

  return await new Promise((resolve) => {
    const upload = request(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
    })
    let done = false
    const finish = (code: number, message?: string) => {
      if (done) {
        return
      }

      done = true
      process.stdin.unpipe(upload)
      process.stdin.destroy()
      if (message) {
        process.stderr.write(`tapet: ${message}\n`)
      }

      resolve(code)
    }

    upload.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        if ((response.statusCode ?? 500) < 400) {
          finish(0)
          return
        }

        finish(1, describeFailure(Buffer.concat(chunks).toString('utf8')))
      })
    })

    upload.on('error', () => finish(1, 'tapet closed the pipe; its session may have ended'))
    process.stdin.pipe(upload)
  })
}

function describeFailure(body: string): string {
  try {
    const { error, session } = JSON.parse(body) as { error?: string; session?: string }
    if (!session) {
      return error ?? body
    }

    return `${error}\nsee: ${commandLine([...selfCommand(), 'logs', '--session', session])}`
  } catch {
    // Not a JSON answer from tapet; show it as it is.
    return body
  }
}
