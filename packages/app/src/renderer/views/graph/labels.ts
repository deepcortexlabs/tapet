// Which labels fit: candidates come most important first, and a label that would overlap one
// already placed, or leave the view, is skipped. Given a cell size, each cell of the view (by where
// a label starts) holds one label at most, so a dense graph isn't buried under text.
export interface LabelBox {
  x: number
  y: number
  width: number
  height: number
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export function placeLabels(
  boxes: (LabelBox | undefined)[],
  bounds: { width: number; height: number },
  cell?: { width: number; height: number },
): number[] {
  const placed: LabelBox[] = []
  const cells = new Set<string>()
  const chosen: number[] = []
  boxes.forEach((box, index) => {
    if (!box) {
      return
    }

    const inside =
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= bounds.width &&
      box.y + box.height <= bounds.height
    const key = cell ? `${Math.floor(box.x / cell.width)},${Math.floor(box.y / cell.height)}` : ''
    if (!inside || (cell && cells.has(key)) || placed.some((other) => overlaps(box, other))) {
      return
    }

    placed.push(box)
    cells.add(key)
    chosen.push(index)
  })
  return chosen
}
