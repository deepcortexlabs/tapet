#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { TAPET_VERSION } from '@tapet/protocol'
import { printLogs } from './logs.ts'
import { runMcp } from './mcp.ts'
import { runPipe } from './pipe.ts'
import { runFeeder } from './run.ts'
import { runSetup } from './setup.ts'

const USAGE = `tapet ${TAPET_VERSION}: a window that AI agents direct over MCP.

  tapet mcp                               the MCP server; your harness starts it
  tapet setup                             download the Electron tapet runs on
  <command> | tapet -c <address>          stream data into a panel (agents get this from panel_create)
            [--ignore-malformed]          skip malformed items instead of stopping
  tapet run -s <address> -- <command>     run a feeder that stops when its session ends
                                          (agents get this from window_update)
  tapet logs --session <id>               show a session's log
`

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args
  if (command === 'mcp') {
    await runMcp()
    return -1
  }

  if (command === 'setup') {
    return await runSetup()
  }

  if (command === 'logs') {
    const { values } = parseArgs({ args: rest, options: { session: { type: 'string' } } })
    if (!values.session) {
      process.stderr.write(USAGE)
      return 1
    }

    return await printLogs(values.session)
  }

  if (command === '-c' || command === '--channel') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { 'ignore-malformed': { type: 'boolean', default: false } },
    })
    const [address] = positionals
    if (!address) {
      process.stderr.write(USAGE)
      return 1
    }

    return await runPipe(address, { ignoreMalformed: values['ignore-malformed'] })
  }

  if (command === 'run') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { session: { type: 'string', short: 's' } },
    })
    if (!values.session || positionals.length === 0) {
      process.stderr.write(USAGE)
      return 1
    }

    return await runFeeder(values.session, positionals)
  }

  if (command === '--version') {
    process.stdout.write(`${TAPET_VERSION}\n`)
    return 0
  }

  process.stdout.write(USAGE)
  return command === undefined || command === '--help' ? 0 : 1
}

const code = await main(process.argv.slice(2))
// `tapet mcp` keeps running until the harness closes it.
if (code >= 0) {
  process.exit(code)
}
