// The attached connection to a session's background process. While it stays open, the session
// is live; when this process exits, the connection closes and the session ends.
import { get } from 'node:http'
import type { RpcMethod, RpcResponse, SessionAddress } from '@tapet/protocol'
import { TapetError } from './paths.ts'

export interface AttachedSession {
  id: string
  isOpen(): boolean
  rpc(method: RpcMethod, params?: unknown): Promise<RpcResponse>
  detach(): void
}

export function attachSession(address: SessionAddress): Promise<AttachedSession> {
  const authorization = `Bearer ${address.token}`
  return new Promise((resolve, reject) => {
    const request = get(`${address.url}/attach`, { headers: { authorization } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        const reason =
          response.statusCode === 409
            ? 'it is attached to another live connection'
            : `status ${response.statusCode}`
        reject(new TapetError(`can't attach to session "${address.id}": ${reason}`))
        return
      }

      let open = true
      let buffer = ''
      let attachment: string | undefined
      response.setEncoding('utf8')
      response.on('close', () => {
        open = false
      })
      response.on('data', (chunk: string) => {
        if (attachment) {
          return
        }

        buffer += chunk
        const newline = buffer.indexOf('\n')
        if (newline < 0) {
          return
        }

        attachment = (JSON.parse(buffer.slice(0, newline)) as { attachment: string }).attachment
        resolve({
          id: address.id,
          isOpen: () => open,
          detach: () => request.destroy(),
          async rpc(method, params) {
            const reply = await fetch(`${address.url}/rpc`, {
              method: 'POST',
              headers: {
                authorization,
                'x-tapet-attachment': attachment ?? '',
                'content-type': 'application/json',
              },
              body: JSON.stringify({ method, params }),
            })
            if (!reply.ok) {
              throw new TapetError(
                `tapet session "${address.id}" refused the request (status ${reply.status})`,
              )
            }

            return (await reply.json()) as RpcResponse
          },
        })
      })
    })
    request.on('error', (error) =>
      reject(new TapetError(`can't reach session "${address.id}": ${error.message}`)),
    )
  })
}
