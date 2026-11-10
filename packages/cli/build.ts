// Builds the npm package, @deepcortex/tapet, into dist/: the CLI and the pipe entry bundled
// with the workspace packages they use, the agent docs, and the built app. `pnpm package` runs it
// after building the app. Its version is TAPET_VERSION.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'
import { TAPET_VERSION } from '@tapet/protocol'

type Manifest = {
  name: string
  type: string
  main: string
  license: string
  engines: Record<string, string>
  dependencies?: Record<string, string>
}

const packages = join(import.meta.dirname, '..')
const root = join(packages, '..')
const dist = join(import.meta.dirname, 'dist')

function manifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest
}

// The workspace packages are bundled; the npm packages they use stay dependencies.
const dependencies: Record<string, string> = {}
for (const name of ['cli', 'core', 'protocol']) {
  for (const [dependency, range] of Object.entries(
    manifest(join(packages, name)).dependencies ?? {},
  )) {
    if (range.startsWith('workspace:')) {
      continue
    }

    if (dependencies[dependency] !== undefined && dependencies[dependency] !== range) {
      throw new Error(`${dependency} has two versions: ${dependencies[dependency]} and ${range}`)
    }

    dependencies[dependency] = range
  }
}

rmSync(dist, { recursive: true, force: true })

// Separate bundles, so the pipe and run entries still load only their own code (see pipe-main.ts).
await build({
  entryPoints: [
    join(import.meta.dirname, 'src', 'main.ts'),
    join(import.meta.dirname, 'src', 'pipe-main.ts'),
    join(import.meta.dirname, 'src', 'run-main.ts'),
  ],
  outdir: join(dist, 'cli'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: Object.keys(dependencies),
  logLevel: 'warning',
})

cpSync(join(import.meta.dirname, 'docs'), join(dist, 'docs'), { recursive: true })

const app = join(packages, 'app')
const { name, type, main } = manifest(app)
cpSync(join(app, 'out'), join(dist, 'app', 'out'), { recursive: true })
cpSync(join(app, 'resources'), join(dist, 'app', 'resources'), { recursive: true })
writeFileSync(
  join(dist, 'app', 'package.json'),
  `${JSON.stringify({ name, type, main }, null, 2)}\n`,
)

cpSync(join(root, 'README.md'), join(dist, 'README.md'))

const { license, engines } = manifest(root)
const published = {
  name: '@deepcortex/tapet',
  version: TAPET_VERSION,
  description: 'A display that AI agents direct over MCP to show things to their user.',
  license,
  repository: { type: 'git', url: 'git+https://github.com/deepcortexlabs/tapet.git' },
  type: 'module',
  bin: { tapet: 'cli/main.js' },
  files: ['cli', 'docs', 'app'],
  engines,
  dependencies,
  publishConfig: { access: 'public' },
}
writeFileSync(join(dist, 'package.json'), `${JSON.stringify(published, null, 2)}\n`)
