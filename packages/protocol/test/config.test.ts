import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadConfig, loadUserConfig } from '../src/index.ts'

// A user config folder and a project folder, isolated from the real ones.
async function folders(user?: string, project?: { name: string; text: string }) {
  const root = await mkdtemp(join(tmpdir(), 'tapet-config-'))
  const env = { XDG_CONFIG_HOME: join(root, 'config') }
  const cwd = join(root, 'project')
  await mkdir(join(env.XDG_CONFIG_HOME, 'tapet'), { recursive: true })
  await mkdir(join(cwd, '.tapet'), { recursive: true })
  if (user !== undefined) {
    await writeFile(join(env.XDG_CONFIG_HOME, 'tapet', 'config.json'), user)
  }

  if (project) {
    await writeFile(join(cwd, '.tapet', project.name), project.text)
  }

  return { env, cwd, root }
}

it('uses defaults when nothing is configured', async () => {
  const { env, cwd } = await folders()
  const { config, issues } = await loadConfig({ cwd, env })
  expect(issues).toEqual([])
  expect(config).toEqual({
    providers: {},
    models: [],
    smart_input_tokens: 50_000,
    window_focus: 'never',
    ended_panels: 'keep',
    daily_token_cap: 2_000_000,
    app_presence: 'dock',
  })
})

it('lets each layer replace settings below it, provider by provider', async () => {
  const user = JSON.stringify({
    providers: { anthropic: { api_key: 'user-anthropic' }, openai: { api_key: 'user-openai' } },
    models: ['anthropic/claude-haiku-4-5'],
  })
  const project = {
    name: 'config.json',
    text: JSON.stringify({ providers: { openai: { api_key: 'project-openai' } } }),
  }
  const { env, cwd } = await folders(user, project)
  const { config } = await loadConfig({
    cwd,
    env: { ...env, GOOGLE_GENERATIVE_AI_API_KEY: 'env-google' },
  })
  expect(config.providers).toEqual({
    anthropic: { api_key: 'user-anthropic' },
    openai: { api_key: 'project-openai' },
    google: { api_key: 'env-google' },
  })
  expect(config.models).toEqual(['anthropic/claude-haiku-4-5'])
  expect(config.default_model).toBe('anthropic/claude-haiku-4-5')
})

it('reads .env files with the standard key names and TAPET_ settings', async () => {
  const text = [
    '# tapet',
    'export OPENAI_API_KEY="sk-test"',
    "TAPET_MODELS='openai/gpt-5-mini, anthropic/claude-haiku-4-5'",
    'TAPET_DAILY_TOKEN_CAP=1000000',
  ].join('\n')
  const { env, cwd } = await folders(undefined, { name: 'config.env', text })
  const { config, issues } = await loadConfig({ cwd, env })
  expect(issues).toEqual([])
  expect(config.providers.openai).toEqual({ api_key: 'sk-test' })
  expect(config.models).toEqual(['openai/gpt-5-mini', 'anthropic/claude-haiku-4-5'])
  expect(config.daily_token_cap).toBe(1_000_000)
})

it('reports bad settings and keeps the good ones', async () => {
  const user = JSON.stringify({ models: ['haiku'], window_focus: 'open', colour: 'red' })
  const { env, cwd } = await folders(user)
  const { config, issues } = await loadConfig({ cwd, env })
  expect(config.window_focus).toBe('open')
  expect(config.models).toEqual([])
  expect(issues).toHaveLength(2)
  expect(issues).toEqual(
    expect.arrayContaining([
      expect.stringContaining('unknown setting "colour"'),
      expect.stringContaining('models are named "provider/model"'),
    ]),
  )
})

it('reports a default model missing from the list', async () => {
  const user = JSON.stringify({
    models: ['openai/gpt-5-mini'],
    default_model: 'anthropic/claude-haiku-4-5',
  })
  const { env, cwd } = await folders(user)
  expect((await loadConfig({ cwd, env })).issues).toEqual([
    expect.stringContaining("isn't in models"),
  ])
})

it('takes the user layer from TAPET_CONFIG when it is set', async () => {
  const { env, cwd, root } = await folders(JSON.stringify({ window_focus: 'open' }))
  const explicit = join(root, 'elsewhere.json')
  await writeFile(explicit, JSON.stringify({ window_focus: 'update' }))
  expect(
    (await loadConfig({ cwd, env: { ...env, TAPET_CONFIG: explicit } })).config.window_focus,
  ).toBe('update')
})

it("keeps app-wide settings to the user's own layers", async () => {
  const project = { name: 'config.json', text: JSON.stringify({ daily_token_cap: 99_000_000 }) }
  const { env } = await folders(JSON.stringify({ daily_token_cap: 1_000_000 }), project)
  expect((await loadUserConfig(env)).config.daily_token_cap).toBe(1_000_000)
})
