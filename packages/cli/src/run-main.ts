#!/usr/bin/env node
// The feeder command that window_update hands out: `<this file> -s <address> -- <command>`. Like
// pipe-main.ts, it loads only its own code, because it shares standard output and error with the
// feeder it runs.
import { writeSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { runFeeder } from './run.ts'

const USAGE = 'usage: <this command> -s <address> -- <command> [args...]\n'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { session: { type: 'string', short: 's' } },
})

if (!values.session || positionals.length === 0) {
  writeSync(2, USAGE)
  process.exit(1)
}

process.exit(await runFeeder(values.session, positionals))
