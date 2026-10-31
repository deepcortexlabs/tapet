// tapet's config: environment variables, then the user's file, then the project's file. A setting in
// a higher layer replaces the same setting below it; each provider counts as one setting.
import { createReadStream, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

export const PROVIDERS = ['anthropic', 'openai', 'google'] as const
export type ProviderName = (typeof PROVIDERS)[number]

const MODEL_ID = /^(anthropic|openai|google)\/\S+$/
const MODEL_MESSAGE = 'models are named "provider/model", e.g. "anthropic/claude-haiku-4-5"'
const apiKey = z.string().min(1, { error: 'api_key must not be empty' })
const modelId = z.string().regex(MODEL_ID, { error: MODEL_MESSAGE })

export const configSchema = z.strictObject({
  providers: z
    .strictObject({
      anthropic: z.strictObject({ api_key: apiKey.optional() }).optional(),
      openai: z
        .strictObject({
          api_key: apiKey.optional(),
          base_url: z.url({ error: 'base_url must be a URL' }).optional(),
        })
        .optional(),
      google: z.strictObject({ api_key: apiKey.optional() }).optional(),
    })
    .optional(),
  models: z.array(modelId).optional(),
  default_model: modelId.optional(),
  smart_input_tokens: z
    .int()
    .min(1000, { error: 'smart_input_tokens must be at least 1000' })
    .optional(),
  window_focus: z.enum(['never', 'open', 'update']).optional(),
  ended_panels: z.enum(['keep', 'remove']).optional(),
  daily_token_cap: z
    .int()
    .positive({ error: 'daily_token_cap must be a positive whole number' })
    .optional(),
  app_presence: z.enum(['dock', 'menu_bar']).optional(),
})

export type ConfigFile = z.output<typeof configSchema>
export type ProviderSettings = { api_key?: string; base_url?: string }

export interface Config {
  providers: Partial<Record<ProviderName, ProviderSettings>>
  models: string[]
  default_model?: string
  smart_input_tokens: number
  window_focus: 'never' | 'open' | 'update'
  ended_panels: 'keep' | 'remove'
  daily_token_cap: number
  app_presence: 'dock' | 'menu_bar'
}

// What a session needs. Keys stay inside tapet's own processes and never reach the agent.
export type SessionConfig = Omit<Config, 'daily_token_cap' | 'app_presence'>

export interface LoadedConfig {
  config: Config
  // Problems found, prefixed with where they are. The settings involved are ignored.
  issues: string[]
}

interface Layer {
  source: string
  values: Record<string, unknown>
}

export function userConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'tapet')
}

// Every layer: for `tapet mcp`, which reads them each time a session is created or reattached.
export async function loadConfig(options: {
  cwd: string
  env?: NodeJS.ProcessEnv
}): Promise<LoadedConfig> {
  const env = options.env ?? process.env
  const project = await readLayer([
    join(options.cwd, '.tapet', 'config.json'),
    join(options.cwd, '.tapet', 'config.env'),
  ])
  return resolve([envLayer(env), ...(await userLayer(env)), ...project])
}

// The user's layers only: for the app, whose app-wide settings a project must not change.
export async function loadUserConfig(env: NodeJS.ProcessEnv = process.env): Promise<LoadedConfig> {
  return resolve([envLayer(env), ...(await userLayer(env))])
}

async function userLayer(env: NodeJS.ProcessEnv): Promise<Layer[]> {
  if (env.TAPET_CONFIG) {
    return await readLayer([env.TAPET_CONFIG])
  }

  const dir = userConfigDir(env)
  return await readLayer([join(dir, 'config.json'), join(dir, 'config.env')])
}

// Reads the first of the paths that exists. Files are read as streams, which also works with the
// named pipes 1Password mounts.
async function readLayer(paths: string[]): Promise<Layer[]> {
  const path = paths.find((candidate) => existsSync(candidate))
  if (!path) {
    return []
  }

  const text = await readStream(path)
  if (path.endsWith('.json')) {
    try {
      return [{ source: path, values: JSON.parse(text) as Record<string, unknown> }]
    } catch (error) {
      return [{ source: path, values: { __invalid: `not valid JSON: ${String(error)}` } }]
    }
  }

  return [{ source: path, values: fromEnv(parseEnvFile(text)) }]
}

function readStream(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    createReadStream(path)
      .on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      .on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
      .on('error', reject)
  })
}

function envLayer(env: NodeJS.ProcessEnv): Layer {
  return { source: 'environment variables', values: fromEnv(env) }
}

export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '')
    const equals = line.indexOf('=')
    if (!line || line.startsWith('#') || equals < 1) {
      continue
    }

    values[line.slice(0, equals).trim()] = unquote(line.slice(equals + 1).trim())
  }

  return values
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll('\\n', '\n').replaceAll('\\"', '"')
  }

  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }

  return value
}

// Maps environment-style names (the standard provider key names plus TAPET_*) to settings.
export function fromEnv(vars: Record<string, string | undefined>): Record<string, unknown> {
  const providers: Record<string, ProviderSettings> = {}
  const provider = (name: ProviderName, settings: ProviderSettings) => {
    const defined = Object.fromEntries(
      Object.entries(settings).filter(([, value]) => value !== undefined),
    )
    if (Object.keys(defined).length > 0) {
      providers[name] = defined
    }
  }
  provider('anthropic', { api_key: vars.ANTHROPIC_API_KEY })
  provider('openai', { api_key: vars.OPENAI_API_KEY, base_url: vars.OPENAI_BASE_URL })
  provider('google', { api_key: vars.GOOGLE_GENERATIVE_AI_API_KEY })

  const number = (value: string | undefined) => (value === undefined ? undefined : Number(value))
  const settings: Record<string, unknown> = {
    providers: Object.keys(providers).length > 0 ? providers : undefined,
    models: vars.TAPET_MODELS?.split(',')
      .map((model) => model.trim())
      .filter(Boolean),
    default_model: vars.TAPET_DEFAULT_MODEL,
    smart_input_tokens: number(vars.TAPET_SMART_INPUT_TOKENS),
    window_focus: vars.TAPET_WINDOW_FOCUS,
    ended_panels: vars.TAPET_ENDED_PANELS,
    daily_token_cap: number(vars.TAPET_DAILY_TOKEN_CAP),
    app_presence: vars.TAPET_APP_PRESENCE,
  }
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined))
}

function resolve(layers: Layer[]): LoadedConfig {
  const issues: string[] = []
  const merged: ConfigFile = {}
  for (const layer of layers) {
    const values = validLayer(layer, issues)
    const { providers, ...rest } = values
    Object.assign(merged, rest)
    if (providers) {
      merged.providers = { ...merged.providers, ...providers }
    }
  }

  const models = merged.models ?? (merged.default_model ? [merged.default_model] : [])
  const defaultModel = merged.default_model ?? models[0]
  if (defaultModel && !models.includes(defaultModel)) {
    issues.push(`default_model "${defaultModel}" isn't in models; add it there`)
  }

  return {
    issues,
    config: {
      providers: merged.providers ?? {},
      models,
      ...(defaultModel ? { default_model: defaultModel } : {}),
      smart_input_tokens: merged.smart_input_tokens ?? 50_000,
      window_focus: merged.window_focus ?? 'never',
      ended_panels: merged.ended_panels ?? 'keep',
      daily_token_cap: merged.daily_token_cap ?? 2_000_000,
      app_presence: merged.app_presence ?? 'dock',
    },
  }
}

// Validates a layer, reporting problems and dropping the settings they're in.
function validLayer(layer: Layer, issues: string[]): ConfigFile {
  if (typeof layer.values.__invalid === 'string') {
    issues.push(`${layer.source}: ${layer.values.__invalid}`)
    return {}
  }

  const parsed = configSchema.safeParse(layer.values)
  if (parsed.success) {
    return parsed.data
  }

  const broken = new Set<string>()
  for (const issue of parsed.error.issues) {
    if (issue.code === 'unrecognized_keys' && issue.path.length === 0) {
      for (const key of issue.keys) {
        issues.push(`${layer.source}: unknown setting "${key}"`)
        broken.add(key)
      }

      continue
    }

    const [top = ''] = issue.path.map(String)
    issues.push(
      `${layer.source}: ${issue.path.map(String).join('.') || '(file)'}: ${issue.message}`,
    )
    broken.add(top)
  }

  const kept = Object.fromEntries(Object.entries(layer.values).filter(([key]) => !broken.has(key)))
  const retried = configSchema.safeParse(kept)
  return retried.success ? retried.data : {}
}
