// Turns "provider/model" into an AI SDK model, with the key from the session's config.
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { ProviderName, SessionConfig } from '@tapet/protocol'

const KEY_VARIABLES: Record<ProviderName, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
}

export function modelFor(config: SessionConfig, id: string): LanguageModel {
  const slash = id.indexOf('/')
  const provider = id.slice(0, slash)
  const name = id.slice(slash + 1)
  if (provider === 'anthropic') {
    return createAnthropic({ apiKey: requireKey(config, provider) })(name)
  }

  if (provider === 'google') {
    return createGoogleGenerativeAI({ apiKey: requireKey(config, provider) })(name)
  }

  if (provider === 'openai') {
    const baseURL = config.providers.openai?.base_url
    // A custom base URL usually means a proxy or a local server: they speak the chat API, and some need no key.
    if (baseURL) {
      return createOpenAI({ apiKey: config.providers.openai?.api_key ?? 'none', baseURL }).chat(
        name,
      )
    }

    return createOpenAI({ apiKey: requireKey(config, provider) })(name)
  }

  throw new Error(`unknown provider "${provider}"; tapet supports anthropic, openai and google`)
}

function requireKey(config: SessionConfig, provider: ProviderName): string {
  const key = config.providers[provider]?.api_key
  if (!key) {
    throw new Error(
      `no API key for ${provider}: add providers.${provider}.api_key to your tapet config, or set ${KEY_VARIABLES[provider]}`,
    )
  }

  return key
}
