import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { attachSession } from '../src/session-client.ts'
import { fakeApp } from './fake-app.ts'

// The feeder command agents get from window_update.
const RUN = join(import.meta.dirname, '..', 'src', 'run-main.ts')
const apps: Array<Awaited<ReturnType<typeof fakeApp>>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

async function liveSession() {
  const app = await fakeApp()
  apps.push(app)
  const session = await attachSession(await app.start())
  const opened = await session.rpc('windowUpdate', { name: 'test' })
  if (!opened.ok) {
    throw new Error(opened.error.message)
  }

  return { app, session, run: (opened.result as { run: string }).run }
}

// Runs `<run> <command>` and resolves once the feeder printed its first line.
function startRun(address: string, command: string[]) {
  const child = spawn(process.execPath, [RUN, '-s', address, '--', ...command])
  let stdout = ''
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const firstLine = new Promise<string>((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.includes('\n')) {
        resolve(stdout.split('\n')[0] ?? '')
      }
    })
  })
  const exited = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
  return { firstLine, exited }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// A feeder that starts a background process and prints its pid, as a looping script would.
const TREE = ['bash', '-c', 'sleep 60 & echo $!; wait']

it("runs the command with the run's output and exit code", async () => {
  const { run } = await liveSession()
  const { exited } = startRun(run, ['bash', '-c', 'echo fed; exit 3'])
  expect(await exited).toEqual({ code: 3, stdout: 'fed\n', stderr: '' })
})

it.skipIf(process.platform === 'win32')(
  'stops the feeder and everything it started when the session ends',
  async () => {
    const { session, run } = await liveSession()
    const { firstLine, exited } = startRun(run, TREE)
    const background = Number(await firstLine)
    expect(isRunning(background)).toBe(true)

    await session.rpc('sessionEnd')
    const { code, stderr } = await exited
    expect(code).toBe(75)
    expect(stderr).toContain('session_attach')
    expect(isRunning(background)).toBe(false)
  },
)

it.skipIf(process.platform === 'win32')('stops the feeder when tapet quits', async () => {
  const { app, run } = await liveSession()
  const { firstLine, exited } = startRun(run, TREE)
  const background = Number(await firstLine)

  await app.close()
  const { code, stderr } = await exited
  expect(code).toBe(1)
  expect(stderr).toContain('tapet quit')
  expect(isRunning(background)).toBe(false)
})

it("doesn't start the feeder when the session has already ended", async () => {
  const { session, run } = await liveSession()
  await session.rpc('sessionEnd')
  const { exited } = startRun(run, ['bash', '-c', 'echo started'])
  const { code, stdout, stderr } = await exited
  expect(code).toBe(75)
  expect(stdout).toBe('')
  expect(stderr).toContain('session_attach')
})
