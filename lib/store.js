/**
 * 手写白板的本地存储（$DSH_HOME/storages/dsh-whiteboard.json）。
 * 只依赖 Node 内置模块；写入走临时文件 + rename，避免读到半截文件。
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

const STORE_FILE = 'dsh-whiteboard.json'
const MAX_BOARDS = 200
const MAX_STROKES = 3000
const MAX_POINTS_PER_STROKE = 4000
const MAX_THUMBNAIL_CHARS = 300_000
const TOOLS = new Set(['pencil', 'pen', 'brush', 'marker', 'eraser'])
const BACKGROUNDS = new Set(['grid', 'blank'])
/** 普通笔画的粗细上限（size）。 */
const MAX_STROKE_SIZE = 60
/**
 * 橡皮擦笔画的 size 上限：客户端把「橡皮直径 ÷ 2.6」存进 size，
 * 300 对应直径约 780 世界像素（界面滑块上限 400，留足余量）。
 * 旧版限制是 60（直径 156），加大后旧橡皮笔画宽度不变。
 */
export const MAX_ERASER_SIZE = 300
/** 无限画布的世界坐标范围（像素），足够容纳远距离平移。 */
const WORLD_LIMIT = 100_000
/** 旧版白板坐标是 0~1 归一化，迁移时映射到 1600×1000 的世界坐标。 */
const LEGACY_WIDTH = 1600
const LEGACY_HEIGHT = 1000

function homeDir() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function storeFile() {
  return join(homeDir(), 'storages', STORE_FILE)
}

function text(value, limit = 200) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function number(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizePoint(point, legacy) {
  if (!Array.isArray(point) || point.length < 2) return null
  const rawX = Number(point[0])
  const rawY = Number(point[1])
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null
  const x = legacy ? rawX * LEGACY_WIDTH : rawX
  const y = legacy ? rawY * LEGACY_HEIGHT : rawY
  return [
    Math.round(Math.min(WORLD_LIMIT, Math.max(-WORLD_LIMIT, x)) * 100) / 100,
    Math.round(Math.min(WORLD_LIMIT, Math.max(-WORLD_LIMIT, y)) * 100) / 100,
    Math.round(number(point[2], 0.5, 0, 1) * 100) / 100,
  ]
}

function normalizeStroke(stroke, legacy) {
  if (stroke === null || typeof stroke !== 'object') return null
  const tool = TOOLS.has(stroke.tool) ? stroke.tool : 'pen'
  const color = /^#[0-9a-f]{6}$/i.test(String(stroke.color ?? '')) ? String(stroke.color) : '#1f2937'
  const sizeLimit = tool === 'eraser' ? MAX_ERASER_SIZE : MAX_STROKE_SIZE
  const size = Math.round(number(stroke.size, 4, 1, sizeLimit) * 10) / 10
  const points = []
  for (const point of Array.isArray(stroke.points) ? stroke.points : []) {
    const normalized = normalizePoint(point, legacy)
    if (normalized !== null) points.push(normalized)
    if (points.length >= MAX_POINTS_PER_STROKE) break
  }
  if (points.length < 2) return null
  return { tool, color, size, points }
}

function normalizeView(value) {
  if (value === null || typeof value !== 'object') return null
  const x = number(value.x, 0, -WORLD_LIMIT, WORLD_LIMIT)
  const y = number(value.y, 0, -WORLD_LIMIT, WORLD_LIMIT)
  const scale = number(value.scale, 1, 0.05, 16)
  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    scale: Math.round(scale * 1000) / 1000,
  }
}

function normalizeBoard(raw, options = {}) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const now = options.now ?? new Date().toISOString()
  const id = /^[a-z0-9-]{6,64}$/i.test(String(input.id ?? '')) ? String(input.id) : randomUUID()
  const title = text(input.title, 80) || '未命名白板'
  // coords!=='world' 的旧数据是 0~1 归一化坐标，这里一次性迁移到世界坐标
  const legacy = input.coords !== 'world'
  const strokes = []
  for (const stroke of Array.isArray(input.strokes) ? input.strokes : []) {
    const normalized = normalizeStroke(stroke, legacy)
    if (normalized !== null) strokes.push(normalized)
    if (strokes.length >= MAX_STROKES) break
  }
  const thumbnail = typeof input.thumbnail === 'string' && input.thumbnail.startsWith('data:image/png;base64,')
    ? input.thumbnail.slice(0, MAX_THUMBNAIL_CHARS)
    : ''
  const view = normalizeView(input.view)
  return {
    id,
    title,
    coords: 'world',
    background: BACKGROUNDS.has(input.background) ? input.background : 'grid',
    strokes,
    ...(view === null ? {} : { view }),
    thumbnail,
    createdAt: text(input.createdAt, 40) || now,
    updatedAt: text(input.updatedAt, 40) || now,
  }
}

export function normalizeDocument(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const boards = []
  for (const board of Array.isArray(input.boards) ? input.boards : []) {
    boards.push(normalizeBoard(board))
    if (boards.length >= MAX_BOARDS) break
  }
  return { version: 1, updatedAt: text(input.updatedAt, 40) || new Date().toISOString(), boards }
}

export function boardSummary(board) {
  return {
    id: board.id,
    title: board.title,
    background: board.background,
    strokeCount: board.strokes.length,
    thumbnail: board.thumbnail,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  }
}

export class WhiteboardStore {
  #file
  #doc
  #ready
  #queue = Promise.resolve()

  constructor({ logger = null } = {}) {
    this.#file = storeFile()
    this.#doc = { version: 1, updatedAt: new Date().toISOString(), boards: [] }
    this.#ready = null
    this.logger = logger
  }

  get file() {
    return this.#file
  }

  async load() {
    if (this.#ready !== null) return this.#ready
    this.#ready = (async () => {
      await mkdir(dirname(this.#file), { recursive: true }).catch(() => {})
      let raw = null
      try {
        raw = await readFile(this.#file, 'utf8')
      } catch (error) {
        if (error?.code !== 'ENOENT') this.logger?.warn?.('whiteboard: read failed: ' + String(error?.message ?? error))
      }
      if (raw === null) return this.#doc
      try {
        this.#doc = normalizeDocument(JSON.parse(raw))
      } catch {
        try { await rename(this.#file, this.#file + '.corrupt-' + Date.now()) } catch { /* ignore */ }
      }
      return this.#doc
    })()
    return this.#ready
  }

  list() {
    return [...this.#doc.boards]
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map(boardSummary)
  }

  get(id) {
    const board = this.#doc.boards.find((item) => item.id === id)
    return board === undefined ? null : structuredClone(board)
  }

  async create(title) {
    await this.load()
    const now = new Date().toISOString()
    const board = normalizeBoard({ id: randomUUID(), title, createdAt: now, updatedAt: now }, { now })
    this.#doc.boards.unshift(board)
    if (this.#doc.boards.length > MAX_BOARDS) this.#doc.boards.length = MAX_BOARDS
    await this.#persist()
    return structuredClone(board)
  }

  async save(id, patch) {
    await this.load()
    const index = this.#doc.boards.findIndex((item) => item.id === id)
    if (index < 0) return null
    const previous = this.#doc.boards[index]
    const input = patch !== null && typeof patch === 'object' ? patch : {}
    const next = normalizeBoard({
      ...previous,
      title: input.title === undefined ? previous.title : input.title,
      background: input.background === undefined ? previous.background : input.background,
      strokes: input.strokes === undefined ? previous.strokes : input.strokes,
      view: input.view === undefined ? previous.view : input.view,
      thumbnail: input.thumbnail === undefined ? previous.thumbnail : input.thumbnail,
      updatedAt: new Date().toISOString(),
    })
    this.#doc.boards[index] = next
    await this.#persist()
    return structuredClone(next)
  }

  async rename(id, title) {
    return await this.save(id, { title })
  }

  async remove(id) {
    await this.load()
    const index = this.#doc.boards.findIndex((item) => item.id === id)
    if (index < 0) return null
    const [removed] = this.#doc.boards.splice(index, 1)
    await this.#persist()
    return removed
  }

  async #persist() {
    this.#doc.updatedAt = new Date().toISOString()
    const payload = JSON.stringify(this.#doc)
    const tmp = this.#file + '.tmp-' + process.pid + '-' + Date.now()
    this.#queue = this.#queue.then(async () => {
      await writeFile(tmp, payload, 'utf8')
      try {
        await rename(tmp, this.#file)
      } catch (error) {
        try { await unlink(tmp) } catch { /* ignore */ }
        throw error
      }
    })
    return await this.#queue
  }
}

export const WHITEBOARD_STORE_FILE = STORE_FILE
