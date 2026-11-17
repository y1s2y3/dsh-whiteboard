/**
 * 手写白板的 HTTP API（挂在 ctx.webServer 的 `/dsh-whiteboard` 前缀）。
 */
import { MAX_ERASER_SIZE } from './store.js'
import { checkForUpdate, CURRENT_VERSION, UPDATE_REPO } from './update-check.js'

export const ROUTE_PREFIX = '/dsh-whiteboard'

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 12 * 1024 * 1024) throw new Error('白板数据过大（超过 12 MB）')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw new Error('请求内容不是合法 JSON')
  }
}

export function registerRoutes(ctx, deps) {
  const { store, logger, updateChecker = checkForUpdate } = deps

  async function handler(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://whiteboard.local')
      const rest = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
      const segments = rest === '' ? [] : rest.split('/').map((item) => decodeURIComponent(item))
      const method = (req.method ?? 'GET').toUpperCase()
      await store.load()

      if (segments.length === 1 && segments[0] === 'health') {
        sendJson(res, 200, {
          ok: true,
          plugin: 'dsh-whiteboard',
          version: CURRENT_VERSION,
          repo: UPDATE_REPO,
          file: store.file,
          eraserSizeMax: MAX_ERASER_SIZE,
        })
        return
      }

      if (segments.length === 1 && segments[0] === 'update-check' && method === 'GET') {
        const force = url.searchParams.get('force') === '1'
        const result = await updateChecker({ force })
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (segments.length === 0 && method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          version: CURRENT_VERSION,
          repo: UPDATE_REPO,
          boards: store.list(),
          file: store.file,
          // 客户端据此决定橡皮大小滑块上限；旧宿主没有该字段时客户端按 60 兜底
          eraserSizeMax: MAX_ERASER_SIZE,
        })
        return
      }

      if (segments.length === 1 && segments[0] === 'boards' && method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          version: CURRENT_VERSION,
          repo: UPDATE_REPO,
          boards: store.list(),
          file: store.file,
          eraserSizeMax: MAX_ERASER_SIZE,
        })
        return
      }

      if (segments.length === 1 && segments[0] === 'boards' && method === 'POST') {
        const body = await readJson(req)
        const board = await store.create(typeof body.title === 'string' ? body.title : '')
        sendJson(res, 200, { ok: true, board })
        return
      }

      if (segments.length === 2 && segments[0] === 'boards') {
        const id = segments[1]
        if (method === 'GET') {
          const board = store.get(id)
          if (board === null) {
            sendJson(res, 404, { ok: false, error: '白板不存在或已删除' })
            return
          }
          sendJson(res, 200, { ok: true, board })
          return
        }
        if (method === 'PUT' || method === 'PATCH') {
          const body = await readJson(req)
          const board = await store.save(id, body)
          if (board === null) {
            sendJson(res, 404, { ok: false, error: '白板不存在或已删除' })
            return
          }
          sendJson(res, 200, { ok: true, board })
          return
        }
        if (method === 'DELETE') {
          const removed = await store.remove(id)
          sendJson(res, removed === null ? 404 : 200, removed === null
            ? { ok: false, error: '白板不存在或已删除' }
            : { ok: true })
          return
        }
      }

      sendJson(res, 404, { ok: false, error: '未知接口：' + method + ' ' + url.pathname })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger?.warn?.('whiteboard: request failed: ' + message)
      sendJson(res, 400, { ok: false, error: message })
    }
  }

  return ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
}
