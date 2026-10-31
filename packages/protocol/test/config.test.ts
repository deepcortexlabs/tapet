import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadConfig, loadUserConfig } from '../src/index.ts'

interface Files {
  user?: unknown
  userEnv?: string
  project?: unknown
  projectEnv?: string
}

// A user config folder and a project folder, isolated from the real ones.
async function folders(files: Files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tapet-config-'))
  const env = { XDG_CONFIG_HOME: join(root, 'config') }
  const user = join(env.XDG_CONFIG_HOME, 'tapet')
  const cwd = join(root, 'project')
  await mkdir(user, { recursive: true })
  await mkdir(join(cwd, '.tapet'), { recursive: true })
  const write = async (path: string, content: unknown) => {
    if (content !== undefined) {
      await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
    }
  }
  await write(join(user, 'config.json'), files.user)
  await write(join(user, 'config.env'), files.userEnv)
  await write(join(cwd, '.tapet', 'config.json'), files.project)
  await write(join(cwd, '.tapet', 'config.env'), files.projectEnv)
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
  const { env, cwd } = await folders({
    user: {
      providers: { anthropic: { api_key: 'user-anthropic' }, openai: { api_key: 'user-openai' } },
      models: ['anthropic/claude-haiku-4-5'],
    },
    project: { providers: { openai: { api_key: 'project-openai' } } },
  })
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

it('picks up keys with the standard names from a mounted config.env, with no JSON for them', async () => {
  const { env, cwd } = await folders({
    user: { models: ['anthropic/claude-haiku-5-5'] },
    userEnv: '# mounted by 1Password\nexport ANTHROPIC_API_KEY="from-the-mount"\n',
  })
  const { config, issues } = await loadConfig({ cwd, env })
  expect(issues).toEqual([])
  expect(config.providers.anthropic).toEqual({ api_key: 'from-the-mount' })
  expect(config.models).toEqual(['anthropic/claude-haiku-5-5'])
})

it('fills ${NAME} references from the environment and from config.env', async () => {
  const { env, cwd } = await folders({
    user: {
      providers: {
        anthropic: { api_key: '${CLAUDE_KEY}' },
        openai: { base_url: 'https://${HOST}/v1' },
      },
    },
    userEnv: "CLAUDE_KEY='from-the-mount'",
  })
  const { config, issues } = await loadConfig({ cwd, env: { ...env, HOST: 'proxy.example' } })
  expect(issues).toEqual([])
  expect(config.providers).toEqual({
    anthropic: { api_key: 'from-the-mount' },
    openai: { base_url: 'https://proxy.example/v1' },
  })
})

it("lets a project's committed config reference the user's secrets", async () => {
  const { env, cwd } = await folders({
    userEnv: 'TEAM_KEY=secret',
    project: { providers: { openai: { api_key: '${TEAM_KEY}' } } },
  })
  expect((await loadConfig({ cwd, env })).config.providers.openai).toEqual({ api_key: 'secret' })
})

it('reports a reference that has no value and drops only the setting it is in', async () => {
  const { env, cwd } = await folders({
    user: { providers: { anthropic: { api_key: '${NOPE}' }, openai: { api_key: 'ok' } } },
  })
  const { config, issues } = await loadConfig({ cwd, env })
  expect(config.providers).toEqual({ openai: { api_key: 'ok' } })
  expect(issues).toEqual([
    expect.stringContaining("providers.anthropic.api_key: ${NOPE} isn't set"),
  ])
})

it('keeps $${ as a literal ${', async () => {
  const { env, cwd } = await folders({ user: { providers: { openai: { api_key: 'a$${b}' } } } })
  expect((await loadConfig({ cwd, env })).config.providers.openai).toEqual({ api_key: 'a${b}' })
})

it('reports bad settings and keeps the good ones', async () => {
  const { env, cwd } = await folders({
    user: { models: ['haiku'], window_focus: 'open', colour: 'red' },
  })
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
  const { env, cwd } = await folders({
    user: { models: ['openai/gpt-5-mini'], default_model: 'anthropic/claude-haiku-4-5' },
  })
  expect((await loadConfig({ cwd, env })).issues).toEqual([
    expect.stringContaining("isn't in models"),
  ])
})

it('takes the user config from TAPET_CONFIG when it is set', async () => {
  const { env, cwd, root } = await folders({ user: { window_focus: 'open' } })
  const explicit = join(root, 'elsewhere.json')
  await writeFile(explicit, JSON.stringify({ window_focus: 'update' }))
  expect(
    (await loadConfig({ cwd, env: { ...env, TAPET_CONFIG: explicit } })).config.window_focus,
  ).toBe('update')
})

it("keeps app-wide settings to the user's own layers", async () => {
  const { env } = await folders({
    user: { daily_token_cap: 1_000_000 },
    project: { daily_token_cap: 99_000_000 },
  })
  expect((await loadUserConfig(env)).config.daily_token_cap).toBe(1_000_000)
})
