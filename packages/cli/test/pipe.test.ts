import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { attachSession } from '../src/session-client.ts'
import { fakeApp } from './fake-app.ts'

const CLI = join(import.meta.dirname, '..', 'src', 'main.ts')
// The pipe command agents get from panel_create.
const PIPE = join(import.meta.dirname, '..', 'src', 'pipe-main.ts')
const apps: Array<Awaited<ReturnType<typeof fakeApp>>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

function runCli(args: string[], input: string, home: string, entry = PIPE) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [entry, ...args], {
      env: { ...process.env, TAPET_HOME: home },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(input)
  })
}

async function panelChannel(settings: Record<string, unknown>) {
  const app = await fakeApp()
  apps.push(app)
  const session = await attachSession(await app.start())
  await session.rpc('windowUpdate', { name: 'test' })
  const created = await session.rpc('panelCreate', { id: 'p', title: 'P', ...settings })
  if (!created.ok) {
    throw new Error(created.error.message)
  }

  return { app, channel: (created.result as { channel: string }).channel }
}

it('streams standard input into a panel and prints nothing', async () => {
  const { app, channel } = await panelChannel({ preset: 'log' })
  expect(await runCli(['-c', channel], 'one\ntwo\n', app.home)).toEqual({
    code: 0,
    stdout: '',
    stderr: '',
  })
})

it('streams through the main command too', async () => {
  const { app, channel } = await panelChannel({ preset: 'log' })
  expect((await runCli(['-c', channel], 'one\n', app.home, CLI)).code).toBe(0)
})

it('stops at malformed data and says how to read the session log', async () => {
  const { app, channel } = await panelChannel({
    format: 'ndjson',
    update: 'append',
    view: 'table',
  })
  const { code, stderr } = await runCli(['-c', channel], '{"a":1}\nnot json\n', app.home)
  expect(code).toBe(1)
  expect(stderr).toContain('malformed data')
  expect(stderr).toContain('logs --session')
})

it('skips malformed data with --ignore-malformed', async () => {
  const { app, channel } = await panelChannel({
    format: 'ndjson',
    update: 'append',
    view: 'table',
  })
  const { code } = await runCli(
    ['-c', channel, '--ignore-malformed'],
    '{"a":1}\nnot json\n',
    app.home,
  )
  expect(code).toBe(0)
})

// A pipe command that shares its standard output with another writer, as in
// `tee >(<pipe>) | slow-reader`, must leave that output blocking: otherwise the other writer
// gets EAGAIN and its data is lost.
it.skipIf(process.platform === 'win32')(
  "leaves a shared standard output blocking, so other writers don't lose data",
  async () => {
    const { app, channel } = await panelChannel({ preset: 'log', retention: { last: 10 } })
    const lines = 200_000
    const script = `seq 1 ${lines} | tee >("${process.execPath}" "${PIPE}" -c ${channel}) | (sleep 1; wc -l)`
    const counted = await new Promise<string>((resolve) => {
      const child = spawn('bash', ['-c', script], { env: { ...process.env, TAPET_HOME: app.home } })
      let stdout = ''
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
      child.on('close', () => resolve(stdout.trim()))
    })
    expect(Number(counted)).toBe(lines)
  },
)
