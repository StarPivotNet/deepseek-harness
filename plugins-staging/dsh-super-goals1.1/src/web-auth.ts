/**
 * Raw webServer 路由不继承 Connection 鉴权篱笆；包一层 requestRejection。
 * 缺 connection → 503；未登录 → 401；拒绝的 Host/Origin → 403。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

export type BrowserRequestGate = {
  requestRejection(req: IncomingMessage): number | undefined
}

export interface WebRouteHost {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

export function authenticatedWebRoutes(
  server: WebRouteHost,
  connection: () => BrowserRequestGate | undefined,
): WebRouteHost {
  return {
    register(route) {
      return server.register({
        ...route,
        async handler(req, res) {
          const gate = connection()
          const rejection = gate === undefined ? 503 : gate.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify({
              ok: false,
              error: {
                code: rejection === 503 ? 'AUTH_UNAVAILABLE' : rejection === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
                message: rejection === 503 ? 'authentication unavailable'
                  : rejection === 401 ? 'unauthorized' : 'forbidden',
              },
            }))
            return
          }
          await route.handler(req, res)
        },
      })
    },
  }
}
