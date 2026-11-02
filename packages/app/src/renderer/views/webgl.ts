// Whether this window can draw with WebGL 2, which the graph and map views need. Machines without a
// GPU, like most CI runners, may have none.
export function hasWebGL2(): boolean {
  const context = document.createElement('canvas').getContext('webgl2')
  context?.getExtension('WEBGL_lose_context')?.loseContext()
  return context !== null
}

export function noWebGL(view: string): string {
  return `the ${view} view needs WebGL 2, which this window doesn't have (is there a GPU?)`
}
