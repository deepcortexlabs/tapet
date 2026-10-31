#!/usr/bin/env node
// The pipe command that panel_create hands out: `<command> | <this file> -c <address>`. It loads
// only the pipe's own code, because some of the CLI's other modules create process.stdout when
// they load, which would make an output the pipe shares with other processes non-blocking (see
// pipe.ts).
import { writeSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { runPipe } from './pipe.ts'

const { values } = parseArgs({
  options: {
    channel: { type: 'string', short: 'c' },
    'ignore-malformed': { type: 'boolean', default: false },
  },
})

if (!values.channel) {
  writeSync(2, 'usage: <command> | <this command> -c <address> [--ignore-malformed]\n')
  process.exit(1)
}

process.exit(await runPipe(values.channel, { ignoreMalformed: values['ignore-malformed'] }))
