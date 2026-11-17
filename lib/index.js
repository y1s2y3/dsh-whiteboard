/**
 * Host half of dsh-whiteboard：暴露白板存储 API，浏览器半由 dsh.client 自动发现。
 */
import { WhiteboardStore } from './store.js'
import { ROUTE_PREFIX, registerRoutes } from './server.js'

export const name = 'whiteboard'
export const inject = ['webServer']

export function apply(ctx) {
  const store = new WhiteboardStore({ logger: ctx.logger })
  const deps = { store, logger: ctx.logger }
  ctx.effect(() => registerRoutes(ctx, deps), 'whiteboard: http routes')
  store.load().then(
    (doc) => ctx.logger?.info?.('whiteboard: ready — ' + String(doc.boards.length) + ' board(s) at ' + store.file + ' (api ' + ROUTE_PREFIX + ')'),
    (error) => ctx.logger?.error?.(error),
  )
}

export { ROUTE_PREFIX }
