// tapet's config: the standard key environment variables, then the user's config.json, then the
// project's. Strings in the JSON may reference variables as ${NAME}; variables come from the
// environment and from the config.env files next to the JSON (e.g. a 1Password-mounted secrets
// file). A setting in a higher layer replaces the same setting below it; each provider counts as
// one setting.
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
  // ${NAME} references with no value, and where they are.
  missing?: Array<{ path: string[]; name: string }>
}

type Variables = Record<string, string | undefined>

export function userConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'tapet')
}

// Every layer: for `tapet mcp`, which reads them each time a session is created or reattached.
export async function loadConfig(options: {
  cwd: string
  env?: NodeJS.ProcessEnv
}): Promise<LoadedConfig> {
  const env = options.env ?? process.env
  const user = userFiles(env)
  const project = {
    json: join(options.cwd, '.tapet', 'config.json'),
    env: join(options.cwd, '.tapet', 'config.env'),
  }
  const variables = await readVariables(env, [user.env, project.env])
  return resolve([
    keysLayer(variables),
    ...(await readJson(user.json, variables)),
    ...(await readJson(project.json, variables)),
  ])
}

// The user's layers only: for the app, whose app-wide settings a project must not change.
export async function loadUserConfig(env: NodeJS.ProcessEnv = process.env): Promise<LoadedConfig> {
  const user = userFiles(env)
  const variables = await readVariables(env, [user.env])
  return resolve([keysLayer(variables), ...(await readJson(user.json, variables))])
}

function userFiles(env: NodeJS.ProcessEnv) {
  const dir = userConfigDir(env)
  return { json: env.TAPET_CONFIG ?? join(dir, 'config.json'), env: join(dir, 'config.env') }
}

// The environment, then each config.env that exists on top of it.
async function readVariables(env: NodeJS.ProcessEnv, paths: string[]): Promise<Variables> {
  const variables: Variables = { ...env }
  for (const path of paths.filter((candidate) => existsSync(candidate))) {
    Object.assign(variables, parseEnvFile(await readStream(path)))
  }

  return variables
}

// The standard key names, so a key in the environment or in config.env works without any JSON.
function keysLayer(variables: Variables): Layer {
  const providers: Record<string, ProviderSettings> = {}
  const provider = (name: ProviderName, settings: ProviderSettings) => {
    const defined = Object.fromEntries(
      Object.entries(settings).filter(([, value]) => value !== undefined),
    )
    if (Object.keys(defined).length > 0) {
      providers[name] = defined
    }
  }
  provider('anthropic', { api_key: variables.ANTHROPIC_API_KEY })
  provider('openai', { api_key: variables.OPENAI_API_KEY, base_url: variables.OPENAI_BASE_URL })
  provider('google', { api_key: variables.GOOGLE_GENERATIVE_AI_API_KEY })
  return { source: 'environment', values: Object.keys(providers).length > 0 ? { providers } : {} }
}

async function readJson(path: string, variables: Variables): Promise<Layer[]> {
  if (!existsSync(path)) {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await readStream(path))
  } catch (error) {
    return [{ source: path, values: { __invalid: `not valid JSON: ${String(error)}` } }]
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [{ source: path, values: { __invalid: 'must be a JSON object' } }]
  }

  const missing: Array<{ path: string[]; name: string }> = []
  const values = expand(parsed, variables, [], missing) as Record<string, unknown>
  return [{ source: path, values, missing }]
}

// Replaces ${NAME} in every string with the variable's value; $${ stays a literal ${.
function expand(
  value: unknown,
  variables: Variables,
  path: string[],
  missing: Array<{ path: string[]; name: string }>,
): unknown {
  if (typeof value === 'string') {
    return value.replace(
      /\$\$\{|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
      (match, name: string | undefined) => {
        if (match === '$${' || name === undefined) {
          return '${'
        }

        const resolved = variables[name]
        if (resolved === undefined) {
          missing.push({ path, name })
          return ''
        }

        return resolved
      },
    )
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => expand(item, variables, [...path, String(index)], missing))
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        expand(item, variables, [...path, key], missing),
      ]),
    )
  }

  return value
}

// Files are read as streams, which also works with the named pipes 1Password mounts.
function readStream(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    createReadStream(path)
      .on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      .on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
      .on('error', reject)
  })
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

// The setting a path belongs to: a top-level key, or one provider.
function settingOf(path: string[]): string[] {
  const [top = '', provider] = path
  return top === 'providers' && provider !== undefined ? [top, provider] : [top]
}

function withoutSettings(
  values: Record<string, unknown>,
  settings: string[][],
): Record<string, unknown> {
  const kept: Record<string, unknown> = { ...values }
  for (const [top = '', provider] of settings) {
    const providers = kept.providers
    if (provider !== undefined && typeof providers === 'object' && providers !== null) {
      kept.providers = Object.fromEntries(
        Object.entries(providers).filter(([name]) => name !== provider),
      )
      continue
    }

    delete kept[top]
  }

  return kept
}

// Validates a layer, reporting problems and dropping the settings they're in.
function validLayer(layer: Layer, issues: string[]): ConfigFile {
  if (typeof layer.values.__invalid === 'string') {
    issues.push(`${layer.source}: ${layer.values.__invalid}`)
    return {}
  }

  const broken: string[][] = []
  for (const { path, name } of layer.missing ?? []) {
    issues.push(`${layer.source}: ${path.join('.')}: \${${name}} isn't set`)
    broken.push(settingOf(path))
  }

  const values = withoutSettings(layer.values, broken)
  const parsed = configSchema.safeParse(values)
  if (parsed.success) {
    return parsed.data
  }

  const invalid: string[][] = []
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String)
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        issues.push(`${layer.source}: unknown setting "${[...path, key].join('.')}"`)
        invalid.push(settingOf([...path, key]))
      }

      continue
    }

    issues.push(`${layer.source}: ${path.join('.') || '(file)'}: ${issue.message}`)
    invalid.push(settingOf(path))
  }

  const retried = configSchema.safeParse(withoutSettings(values, invalid))
  return retried.success ? retried.data : {}
}
