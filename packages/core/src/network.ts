// The only hosts tapet's window may load from: base maps for the map view. The window's content
// security policy is built from this list at build time, so everything else stays offline.
export const NETWORK_HOSTS: readonly string[] = ['tiles.openfreemap.org']

export function isAllowedUrl(url: string): boolean {
  if (!URL.canParse(url)) {
    return false
  }

  const { protocol, hostname } = new URL(url)
  return protocol === 'https:' && NETWORK_HOSTS.includes(hostname)
}
