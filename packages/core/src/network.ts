// The only hosts tapet may load from: base maps for the map view, and packages that custom views
// import. The content security policies of the window and of custom views are built from this list
// at build time, so everything else stays offline.
export const NETWORK_HOSTS: readonly string[] = [
  'tiles.openfreemap.org',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'esm.sh',
]

export function isAllowedUrl(url: string): boolean {
  if (!URL.canParse(url)) {
    return false
  }

  const { protocol, hostname } = new URL(url)
  return protocol === 'https:' && NETWORK_HOSTS.includes(hostname)
}
