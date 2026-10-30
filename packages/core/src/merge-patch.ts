import { isPlainObject } from './object.ts'

// JSON Merge Patch (RFC 7396). Returns a new value and never modifies the target.
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) {
    return patch
  }

  const result: Record<string, unknown> = isPlainObject(target) ? { ...target } : {}
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[name]
      continue
    }

    // defineProperty keeps a field named "__proto__" a plain field instead of changing the prototype.
    Object.defineProperty(result, name, {
      value: mergePatch(Object.hasOwn(result, name) ? result[name] : undefined, value),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }

  return result
}
