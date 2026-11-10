import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { writeSync } from 'node:fs'
import { get } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { RESUMABLE, describeFailure } from './pipe.ts'

// How long a feeder gets to exit after SIGTERM before its process group is killed.
const STOP_GRACE_MS = 5000
const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const

// `tapet run -s <address> -- <command>`: runs a feeder for as long as its session is live. It holds
// a connection to the session, and when the session ends, is discarded, or tapet quits, it stops
// the feeder's whole process tree. Like the pipe, it shares its standard output and error with the
// feeder, so it never touches process.stdout or process.stderr (see pipe.ts).
export async function runFeeder(address: string, command: string[]): Promise<number> {
  return await new Promise((resolve) => {
    let child: ChildProcess | undefined
    // Set once tapet or a signal stops the feeder, whose exit then doesn't decide the exit code.
    let stopping = false
    let done = false
    let ended: { resumable: boolean } | undefined
    let session = ''

    const finish = (code: number, message?: string) => {
      if (done) {
        return
      }

      done = true
      request.destroy()
      if (message) {
        writeSync(2, `tapet: ${message}\n`)
      }

      resolve(code)
    }

    // The session went away: stop the feeder, then say why.
    const lost = () => {
      if (done || stopping || !child) {
        return
      }

      stopping = true
      const name = session ? `session ${session}` : 'session'
      const [code, message] = ended
        ? ended.resumable
          ? [
              RESUMABLE,
              `the tapet ${name} ended, so its feeder was stopped; after session_attach, start the feeder again`,
            ]
          : [1, `the tapet ${name} ended and was discarded, so its feeder was stopped`]
        : [1, `lost the tapet ${name} (it was discarded or tapet quit), so its feeder was stopped`]
      const running = child
      stopTree(running).then(
        () => finish(code, message),
        (error: unknown) => finish(code, `${message}; stopping it failed: ${String(error)}`),
      )
    }

    const request = get(`http://${address}`, (response) => {
      if (response.statusCode !== 200) {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const failure = describeFailure(Buffer.concat(chunks).toString('utf8'))
          finish(failure.resumable ? RESUMABLE : 1, failure.message)
        })
        return
      }

      let buffer = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        buffer += chunk
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = JSON.parse(buffer.slice(0, newline)) as {
            session?: string
            ended?: boolean
            resumable?: boolean
          }
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
          if (line.ended) {
            ended = { resumable: line.resumable === true }
          }

          if (line.session && !child) {
            session = line.session
            child = start(command, finish, () => stopping)
          }
        }
      })
      response.on('close', lost)
    })
    request.on('error', (error) => {
      if (child) {
        lost()
        return
      }

      finish(1, `can't reach the tapet session: ${error.message}`)
    })

    for (const [signal, number] of Object.entries(SIGNALS)) {
      process.on(signal, () => {
        if (!child) {
          finish(128 + number)
          return
        }

        stopping = true
        const running = child
        stopTree(running).finally(() => finish(128 + number))
      })
    }
  })
}

function start(
  command: string[],
  finish: (code: number, message?: string) => void,
  stopping: () => boolean,
): ChildProcess {
  const [file = '', ...args] = command
  // Its own process group on POSIX, so the whole tree can be stopped at once.
  const child = spawn(file, args, { stdio: 'inherit', detached: process.platform !== 'win32' })
  child.on('error', (error) => finish(127, `couldn't start ${file}: ${error.message}`))
  child.on('exit', (code, signal) => {
    if (stopping()) {
      return
    }

    // The feeder's own exit ends the run; anything it left in the background goes with it.
    const status = code ?? 128 + (signal ? signalNumber(signal) : 0)
    stopTree(child).finally(() => finish(status))
  })
  return child
}

function signalNumber(signal: NodeJS.Signals): number {
  return (SIGNALS as Record<string, number>)[signal] ?? (signal === 'SIGKILL' ? 9 : 0)
}

async function stopTree(child: ChildProcess) {
  const pid = child.pid
  if (pid === undefined) {
    return
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }

  if (!signalGroup(pid, 'SIGTERM')) {
    return
  }

  const deadline = Date.now() + STOP_GRACE_MS
  while (Date.now() < deadline) {
    await sleep(50)
    if (!signalGroup(pid, 0)) {
      return
    }
  }

  signalGroup(pid, 'SIGKILL')
}

// Signals the process group led by pid; false once the group is gone.
function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return false
    }

    throw error
  }
}
