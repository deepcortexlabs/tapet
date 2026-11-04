// Expanding a panel: a double-click on its title bar lifts it out of the agent's layout over most of
// the window. A placeholder keeps its place, so no other panel moves.

// The properties that place a box in its parent's grid or flex layout.
const PLACEMENT = [
  'grid-row-start',
  'grid-row-end',
  'grid-column-start',
  'grid-column-end',
  'order',
  'align-self',
  'justify-self',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
]
const FLEX = ['flex-grow', 'flex-shrink', 'flex-basis']

const DURATION_MS = 220
const EASING = 'cubic-bezier(0.2, 0, 0, 1)'

export interface Hold {
  // The placeholder's inline style.
  style: string
  // Gives the layout its own sizing back, once the panel is in its place again.
  release(): void
}

// Holds an expanding panel's place, so the layout doesn't move: the placeholder takes the panel's
// placement and size. An empty placeholder would size grid tracks differently than the panel's
// content did, so a grid keeps its track sizes while the panel is out. In a flex layout, a fixed
// size gives the other items the same share of the free space as before. A panel the agent
// positioned absolutely leaves no gap, so its placeholder takes no room.
export function holdPlace(panel: HTMLElement): Hold {
  const style = getComputedStyle(panel)
  if (style.position === 'absolute' || style.position === 'fixed') {
    return { style: 'position: absolute; width: 0; height: 0;', release: () => undefined }
  }

  const { width, height } = panel.getBoundingClientRect()
  const declarations = (names: string[]) =>
    names.map((name) => `${name}: ${style.getPropertyValue(name)};`)
  const size = ['box-sizing: border-box;', `width: ${width}px;`, `height: ${height}px;`]
  const parent = panel.parentElement
  const layout = parent ? getComputedStyle(parent) : undefined
  if (layout?.display.endsWith('flex')) {
    const main = layout.flexDirection.startsWith('column') ? height : width
    const flex = `flex: 0 0 ${main}px;`
    return {
      style: [...declarations(PLACEMENT), ...size, flex].join(' '),
      release: () => undefined,
    }
  }

  const placed = [...declarations(PLACEMENT), ...declarations(FLEX), ...size].join(' ')
  if (!parent || !layout?.display.endsWith('grid')) {
    return { style: placed, release: () => undefined }
  }

  // The resolved track lists are in pixels and include implicit tracks.
  const own = { rows: parent.style.gridTemplateRows, columns: parent.style.gridTemplateColumns }
  parent.style.gridTemplateRows = layout.gridTemplateRows
  parent.style.gridTemplateColumns = layout.gridTemplateColumns
  return {
    style: placed,
    release: () => {
      parent.style.gridTemplateRows = own.rows
      parent.style.gridTemplateColumns = own.columns
    },
  }
}

// The transform that shows a box laid out at `box` at the place of `at`.
function transformTo(box: DOMRect, at: DOMRect): string {
  const scale = `scale(${at.width / box.width}, ${at.height / box.height})`
  return `translate(${at.left - box.left}px, ${at.top - box.top}px) ${scale}`
}

function animates(...boxes: DOMRect[]): boolean {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  return !reduced && boxes.every((box) => box.width > 0 && box.height > 0)
}

// Moves a box that's now laid out at `to` from where it was, `from`, with a transform, so its
// content lays out only once, at its new size.
export function moveFrom(element: HTMLElement, from: DOMRect, to: DOMRect): Promise<void> {
  if (!animates(from, to)) {
    return Promise.resolve()
  }

  const keyframes = [
    { transformOrigin: '0 0', transform: transformTo(to, from) },
    { transformOrigin: '0 0', transform: 'none' },
  ]
  return element
    .animate(keyframes, { duration: DURATION_MS, easing: EASING })
    .finished.then(() => undefined)
}

// Moves a box laid out at `from` toward `to`, and holds it there until the returned animation is
// cancelled, once the box is laid out at `to` itself.
export function moveTo(element: HTMLElement, from: DOMRect, to: DOMRect): Animation | undefined {
  if (!animates(from, to)) {
    return undefined
  }

  const keyframes = [
    { transformOrigin: '0 0', transform: 'none' },
    { transformOrigin: '0 0', transform: transformTo(from, to) },
  ]
  return element.animate(keyframes, { duration: DURATION_MS, easing: EASING, fill: 'forwards' })
}

export function fade(element: HTMLElement | undefined, direction: 'in' | 'out') {
  if (!element || !animates()) {
    return
  }

  const keyframes =
    direction === 'in' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }]
  element.animate(keyframes, { duration: DURATION_MS, easing: EASING, fill: 'forwards' })
}
