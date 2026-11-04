// Builds the gallery site into site/dist: an index of all examples and a page for each.
// Each example is a folder in site/examples with an example.json and its media files.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

interface Media {
  src: string
  alt: string
}

interface Example {
  slug: string
  title: string
  summary: string
  prompt: string
  date: string
  media: Media[]
  // The media src the gallery card shows; the first media by default.
  thumbnail?: string
}

const root = import.meta.dirname
const examplesDir = join(root, 'examples')
const dist = join(root, 'dist')
const videoExtensions = new Set(['.mp4', '.webm', '.mov'])

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function renderMedia(media: Media, prefix: string, thumbnail = false) {
  const src = escape(prefix + media.src)
  const alt = escape(media.alt)
  if (videoExtensions.has(extname(media.src).toLowerCase())) {
    const controls = thumbnail ? 'autoplay loop' : 'controls'
    return `<video src="${src}" ${controls} muted playsinline preload="metadata" aria-label="${alt}"></video>`
  }

  return `<img src="${src}" alt="${alt}" loading="lazy" />`
}

function page(title: string, base: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(title)}</title>
<link rel="stylesheet" href="${base}style.css" />
<link rel="icon" href="${base}logo.png" />
</head>
<body>
<header><a href="${base}"><img class="logo" src="${base}logo.png" alt="tapet" /></a></header>
<main>
${body}
</main>
<footer><a href="https://github.com/deepcortexlabs/tapet">tapet on GitHub</a></footer>
</body>
</html>
`
}

const thumbnailOf = (example: Example) =>
  example.media.find((m) => m.src === example.thumbnail) ?? example.media[0]!

function renderIndex(examples: Example[]) {
  const cards = examples
    .map(
      (example) => `<a class="card" href="examples/${example.slug}/">
  <div class="thumb">${renderMedia(thumbnailOf(example), `examples/${example.slug}/`, true)}</div>
  <h2>${escape(example.title)}</h2>
  <p>${escape(example.summary)}</p>
  <div class="card-prompt"><div>${escape(example.prompt)}</div></div>
</a>`,
    )
    .join('\n')

  return page(
    'tapet gallery',
    '',
    `<h1>Gallery</h1>
<p class="lead">Examples of tapet in use, each with the prompt that produced it.</p>
<div class="grid">
${cards}
</div>`,
  )
}

function renderExample(example: Example) {
  const media = example.media.map((m) => `<figure>${renderMedia(m, '')}</figure>`).join('\n')
  return page(
    `${example.title} · tapet gallery`,
    '../../',
    `<p><a href="../../">← Gallery</a></p>
<h1>${escape(example.title)}</h1>
<p class="lead">${escape(example.summary)}</p>
<h2>Prompt</h2>
<pre class="prompt">${escape(example.prompt)}</pre>
${media}`,
  )
}

async function readExample(slug: string): Promise<Example> {
  const data = JSON.parse(await readFile(join(examplesDir, slug, 'example.json'), 'utf8'))
  for (const key of ['title', 'summary', 'prompt', 'date'] as const) {
    if (typeof data[key] !== 'string' || data[key] === '') {
      throw new Error(`${slug}/example.json: "${key}" must be a non-empty string`)
    }
  }

  if (!Array.isArray(data.media) || data.media.length === 0) {
    throw new Error(`${slug}/example.json: "media" must list at least one image or video`)
  }

  if (data.thumbnail !== undefined && !data.media.some((m: Media) => m.src === data.thumbnail)) {
    throw new Error(`${slug}/example.json: "thumbnail" must be the src of one of the media`)
  }

  return { slug, ...data }
}

const slugs = (await readdir(examplesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
const examples = (await Promise.all(slugs.map(readExample))).toSorted((a, b) =>
  b.date.localeCompare(a.date),
)

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await cp(join(root, 'style.css'), join(dist, 'style.css'))
await cp(join(root, '..', 'assets', 'logo.png'), join(dist, 'logo.png'))
await writeFile(join(dist, 'index.html'), renderIndex(examples))

for (const example of examples) {
  const out = join(dist, 'examples', example.slug)
  await cp(join(examplesDir, example.slug), out, {
    recursive: true,
    filter: (src) => !src.endsWith('example.json'),
  })
  await writeFile(join(out, 'index.html'), renderExample(example))
}

console.log(`Built ${examples.length} examples into ${dist}`)
