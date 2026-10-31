import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createUsage } from '../src/main/usage.ts'

async function usagePath() {
  return join(await mkdtemp(join(tmpdir(), 'tapet-usage-')), 'usage.json')
}

it('allows runs until the cap is reached', async () => {
  const usage = createUsage({ path: await usagePath(), cap: 100 })
  await usage.add(60)
  expect(await usage.check()).toEqual({ allowed: true, used: 60, cap: 100 })
  await usage.add(50)
  expect(await usage.check()).toEqual({ allowed: false, used: 110, cap: 100 })
})

it('starts over at local midnight', async () => {
  let clock = new Date(2026, 9, 31, 23, 59)
  const usage = createUsage({ path: await usagePath(), cap: 100, now: () => clock })
  await usage.add(100)
  expect((await usage.check()).allowed).toBe(false)

  clock = new Date(2026, 10, 1, 0, 1)
  expect(await usage.check()).toEqual({ allowed: true, used: 0, cap: 100 })
})

it("survives a restart on the same day, but not yesterday's usage", async () => {
  const path = await usagePath()
  const day = new Date(2026, 9, 31, 12)
  await createUsage({ path, cap: 100, now: () => day }).add(40)

  expect((await createUsage({ path, cap: 100, now: () => day }).check()).used).toBe(40)
  expect(
    (await createUsage({ path, cap: 100, now: () => new Date(2026, 10, 1, 9) }).check()).used,
  ).toBe(0)
})
