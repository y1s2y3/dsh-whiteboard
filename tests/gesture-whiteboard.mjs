/**
 * dsh-whiteboard 手势/橡皮离线测试：
 * 用最小 React 运行时直接调用真实的 CanvasBoard 组件，模拟 Pointer Events，
 * 验证「单指拖动平移 / 双指缩放 / 手写笔书写与擦除 / 橡皮大小拖动换算」。
 * 运行：node whiteboard/tests/gesture-whiteboard.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

let failures = 0
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  ← ' + detail}`)
  if (!condition) failures += 1
}

/* ---------------- 最小 React 运行时（只够直接调用函数组件） ---------------- */
const ReactShim = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (factory) => factory,
}

/* ---------------- 假 DOM 节点 / Canvas 2D 上下文 ---------------- */
function makeContext2d() {
  const store = {}
  return new Proxy(store, {
    get: (target, key) => (key in target && typeof target[key] !== 'undefined' ? target[key] : () => {}),
    set: (target, key, value) => { target[key] = value; return true },
  })
}

function makeDomNode(tag) {
  const width = String(tag) === 'canvas' ? 800 : 96
  return {
    tagName: String(tag).toUpperCase(),
    width: 800,
    height: 600,
    style: {},
    className: '',
    getContext: () => makeContext2d(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height: 600, right: width, bottom: 600 }),
    setPointerCapture() {},
    releasePointerCapture() {},
    addEventListener() {},
    removeEventListener() {},
  }
}

/* ---------------- 加载真实客户端 bundle ---------------- */
const code = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
let definition = null
const fakeWindow = {
  __ModuleLoader__: { load: (value) => { definition = value } },
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 800,
  localStorage: { getItem: () => null, setItem: () => {} },
  setTimeout: () => 0,
  clearTimeout: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
}
new Function('window', code)(fakeWindow)
const moduleExports = definition.factory((name) => {
  if (name === 'react') return ReactShim
  throw new Error('unexpected require: ' + name)
})
const I = moduleExports.__internals

/* ---------------- 组件挂载（不重渲染；setCamera/onStroke 用 spy 记录） ---------------- */
function mountCanvas(overrides = {}) {
  const calls = { camera: [], strokes: [] }
  const props = {
    strokes: [],
    tool: 'pen',
    color: '#1f2937',
    size: 4,
    eraserDiameter: 36,
    background: 'grid',
    penOnly: true,
    camera: { x: 0, y: 0, scale: 1 },
    setCamera: (next) => calls.camera.push(next),
    pendingFit: false,
    onFitDone: () => {},
    onApi: () => {},
    onStroke: (stroke) => calls.strokes.push(stroke),
    ...overrides,
  }
  const tree = I.CanvasBoard(props)
  let handlers = null
  let cursor = null
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const item of node) walk(item); return }
    if (node.props === undefined) return
    if (node.props.ref !== undefined && node.props.ref !== null) node.props.ref.current = makeDomNode(node.type)
    const className = typeof node.props.className === 'string' ? node.props.className : ''
    if (className.includes('wb-canvas--content')) handlers = node.props
    if (className.includes('wb-eraser-cursor')) cursor = node.props.ref.current
    walk(node.children)
  }
  walk(tree)
  if (handlers === null) throw new Error('content canvas not found')
  return { props, calls, handlers, cursor }
}

function pointer(type, options = {}) {
  return {
    type,
    pointerType: 'touch',
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
    buttons: 1,
    pressure: 0.5,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() {},
    ...options,
  }
}

/* 1. 单指拖动 = 平移，不画线（默认的仅手写笔模式） */
{
  const { handlers, calls } = mountCanvas({ tool: 'pen', penOnly: true, camera: { x: 0, y: 0, scale: 2 } })
  handlers.onPointerDown(pointer('pointerdown', { pointerId: 11, clientX: 100, clientY: 100 }))
  check('单指按下不开始笔画', calls.strokes.length === 0 && calls.camera.length === 0, JSON.stringify(calls))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 11, clientX: 140, clientY: 120 }))
  const moved = calls.camera[0]
  check('单指拖动平移画布（位移 ÷ 缩放）', moved !== undefined && moved.scale === 2 && moved.x === -20 && moved.y === -10, JSON.stringify(moved))
  handlers.onPointerUp(pointer('pointerup', { pointerId: 11, clientX: 140, clientY: 120 }))
  check('单指抬起后不产生笔迹', calls.strokes.length === 0, String(calls.strokes.length))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 11, clientX: 200, clientY: 200 }))
  check('抬起后的手指不再平移画布', calls.camera.length === 1, String(calls.camera.length))
}

/* 2. 双指缩放 + 双指平移 + 双指变单指继续平移 */
{
  const { handlers, calls } = mountCanvas({ tool: 'pen', penOnly: true, camera: { x: 0, y: 0, scale: 1 } })
  handlers.onPointerDown(pointer('pointerdown', { pointerId: 21, clientX: 100, clientY: 100 }))
  handlers.onPointerDown(pointer('pointerdown', { pointerId: 22, clientX: 300, clientY: 100 }))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 22, clientX: 350, clientY: 100 }))
  const pinched = calls.camera[calls.camera.length - 1]
  check('双指张开放大 1.25 倍并保持双指中点不动', pinched !== undefined && pinched.scale === 1.25 && pinched.x === 20 && pinched.y === 20, JSON.stringify(pinched))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 21, clientX: 150, clientY: 100 }))
  const panned = calls.camera[calls.camera.length - 1]
  check('双指同向拖动=平移（缩放回到 1 倍）', panned !== undefined && panned.scale === 1 && panned.x === -50 && panned.y === 0, JSON.stringify(panned))
  handlers.onPointerUp(pointer('pointerup', { pointerId: 22, clientX: 350, clientY: 100 }))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 21, clientX: 200, clientY: 130 }))
  const continued = calls.camera[calls.camera.length - 1]
  check('双指抬起一指后，剩下的手指继续平移', continued !== undefined && continued.scale === 1 && continued.x === -50 && continued.y === -30, JSON.stringify(continued))
  handlers.onPointerUp(pointer('pointerup', { pointerId: 21, clientX: 200, clientY: 130 }))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 21, clientX: 260, clientY: 160 }))
  check('全部抬起后手指移动不再平移', calls.camera[calls.camera.length - 1] === continued, JSON.stringify(calls.camera[calls.camera.length - 1]))
  check('双指手势全程不产生笔迹', calls.strokes.length === 0, String(calls.strokes.length))
}

/* 3. 允许手指画线时：单指画线，第二指落下取消未完成笔迹并进入缩放 */
{
  const { handlers, calls } = mountCanvas({ tool: 'pen', penOnly: false, camera: { x: 0, y: 0, scale: 1 } })
  handlers.onPointerDown(pointer('pointerdown', { pointerId: 31, clientX: 100, clientY: 100 }))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 31, clientX: 110, clientY: 110 }))
  check('允许手指画线时单指书写（尚无落笔，未提交）', calls.strokes.length === 0)
  handlers.onPointerDown(pointer('pointerdown', { pointerId: 32, clientX: 300, clientY: 100 }))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 32, clientX: 400, clientY: 100 }))
  const zoomed = calls.camera[calls.camera.length - 1]
  const expectedScale = Math.hypot(290, 10) / Math.hypot(190, 10)
  check('第二指落下后进入双指缩放', zoomed !== undefined && Math.abs(zoomed.scale - expectedScale) < 0.001, JSON.stringify(zoomed))
  handlers.onPointerUp(pointer('pointerup', { pointerId: 31, clientX: 110, clientY: 110 }))
  handlers.onPointerUp(pointer('pointerup', { pointerId: 32, clientX: 400, clientY: 100 }))
  check('被双指打断的手指笔迹不会误提交', calls.strokes.length === 0, String(calls.strokes.length))
}

/* 3.5 笔写时落下的手指：抬笔后推动超过阈值即接管平移（不用抬起重按） */
{
  const { handlers, calls } = mountCanvas({ tool: 'pen', penOnly: true, camera: { x: 0, y: 0, scale: 1 } })
  handlers.onPointerDown(pointer('pointerdown', { pointerType: 'pen', pointerId: 81, clientX: 100, clientY: 100 }))
  handlers.onPointerMove(pointer('pointermove', { pointerType: 'pen', pointerId: 81, clientX: 110, clientY: 110 }))
  handlers.onPointerDown(pointer('pointerdown', { pointerId: 82, clientX: 300, clientY: 300 }))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 82, clientX: 320, clientY: 320 }))
  check('笔写期间落下的手指不会平移画布', calls.camera.length === 0, JSON.stringify(calls.camera))
  handlers.onPointerUp(pointer('pointerup', { pointerType: 'pen', pointerId: 81, clientX: 110, clientY: 110 }))
  check('抬笔后正常提交笔迹', calls.strokes.length === 1)
  handlers.onPointerMove(pointer('pointermove', { pointerId: 82, clientX: 324, clientY: 322 }))
  check('手指轻微挪动（<10px）不误触发平移', calls.camera.length === 0, JSON.stringify(calls.camera))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 82, clientX: 340, clientY: 330 }))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 82, clientX: 360, clientY: 340 }))
  const move = calls.camera[calls.camera.length - 1]
  check('抬笔后推动手指（无需抬起重按）开始平移', move !== undefined && move.x === -20 && move.y === -10, JSON.stringify(move))
  handlers.onPointerUp(pointer('pointerup', { pointerId: 82, clientX: 360, clientY: 340 }))
}

/* 3.55 手掌（大接触面积）不会被误接管为平移 */
{
  const { handlers, calls } = mountCanvas({ tool: 'pen', penOnly: true, camera: { x: 0, y: 0, scale: 1 } })
  handlers.onPointerDown(pointer('pointerdown', { pointerType: 'pen', pointerId: 93, clientX: 100, clientY: 100 }))
  handlers.onPointerDown(pointer('pointerdown', { pointerId: 94, clientX: 400, clientY: 300, width: 60, height: 70 }))
  handlers.onPointerUp(pointer('pointerup', { pointerType: 'pen', pointerId: 93, clientX: 100, clientY: 100 }))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 94, clientX: 460, clientY: 360 }))
  check('手掌（大接触面积）挪动不会被当成平移', calls.camera.length === 0, JSON.stringify(calls.camera))
}

/* 3.6 笔写打断手指平移：抬笔后立即续上平移 */
{
  const { handlers, calls } = mountCanvas({ tool: 'pen', penOnly: true, camera: { x: 0, y: 0, scale: 1 } })
  handlers.onPointerDown(pointer('pointerdown', { pointerId: 91, clientX: 200, clientY: 200 }))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 91, clientX: 220, clientY: 210 }))
  check('手指先拖动平移', calls.camera.length === 1, JSON.stringify(calls.camera))
  handlers.onPointerDown(pointer('pointerdown', { pointerType: 'pen', pointerId: 92, clientX: 100, clientY: 100 }))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 91, clientX: 260, clientY: 230 }))
  check('笔写期间已按下的手指暂停平移', calls.camera.length === 1, String(calls.camera.length))
  handlers.onPointerUp(pointer('pointerup', { pointerType: 'pen', pointerId: 92, clientX: 100, clientY: 100 }))
  handlers.onPointerMove(pointer('pointermove', { pointerId: 91, clientX: 300, clientY: 250 }))
  const move = calls.camera[calls.camera.length - 1]
  check('抬笔后原来的手指继续平移（从当前位置接上）', move !== undefined && move.x === -40 && move.y === -20, JSON.stringify(move))
  handlers.onPointerUp(pointer('pointerup', { pointerId: 91, clientX: 300, clientY: 250 }))
}

/* 4. 手写笔书写 + 手掌防误触 */
{
  const { handlers, calls } = mountCanvas({ tool: 'pen', penOnly: true, camera: { x: 0, y: 0, scale: 1 } })
  handlers.onPointerDown(pointer('pointerdown', { pointerType: 'pen', pointerId: 41, clientX: 200, clientY: 200, pressure: 0.6 }))
  handlers.onPointerDown(pointer('pointerdown', { pointerType: 'touch', pointerId: 42, clientX: 320, clientY: 300 }))
  handlers.onPointerMove(pointer('pointermove', { pointerType: 'touch', pointerId: 42, clientX: 340, clientY: 320 }))
  check('书写时落下的手掌不会平移画布', calls.camera.length === 0, JSON.stringify(calls.camera))
  handlers.onPointerMove(pointer('pointermove', { pointerType: 'pen', pointerId: 41, clientX: 230, clientY: 215, pressure: 0.7 }))
  handlers.onPointerUp(pointer('pointerup', { pointerType: 'pen', pointerId: 41, clientX: 230, clientY: 215, pressure: 0.3 }))
  check('手写笔书写提交一笔', calls.strokes.length === 1 && calls.strokes[0].tool === 'pen' && calls.strokes[0].points.length >= 2, JSON.stringify(calls.strokes[0]?.tool))
  check('手掌触摸不产生额外笔迹', calls.strokes.length === 1, String(calls.strokes.length))
}

/* 5. 手写笔笔上橡皮按钮（button 5 / buttons & 32）临时擦除，且使用橡皮直径 */
{
  const { handlers, calls } = mountCanvas({ tool: 'pen', penOnly: true, eraserDiameter: 52 })
  handlers.onPointerDown(pointer('pointerdown', { pointerType: 'pen', pointerId: 51, button: 5, buttons: 32, clientX: 100, clientY: 100 }))
  handlers.onPointerMove(pointer('pointermove', { pointerType: 'pen', pointerId: 51, button: 5, buttons: 32, clientX: 160, clientY: 140 }))
  handlers.onPointerUp(pointer('pointerup', { pointerType: 'pen', pointerId: 51, clientX: 160, clientY: 140 }))
  const stroke = calls.strokes[0]
  check('笔上橡皮键触发像素级擦除笔画', stroke !== undefined && stroke.tool === 'eraser', JSON.stringify(stroke?.tool))
  check('笔上橡皮键使用橡皮直径（52 ÷ 2.6 = 20）', stroke !== undefined && Math.abs(stroke.size - 20) < 0.01, JSON.stringify(stroke?.size))
}

/* 6. 选中橡皮工具书写：提交擦除笔画并使用拖动设置的直径 */
{
  const { handlers, calls } = mountCanvas({ tool: 'eraser', penOnly: true, eraserDiameter: 130 })
  handlers.onPointerDown(pointer('pointerdown', { pointerType: 'pen', pointerId: 61, clientX: 100, clientY: 100 }))
  handlers.onPointerUp(pointer('pointerup', { pointerType: 'pen', pointerId: 61, clientX: 100, clientY: 100 }))
  const stroke = calls.strokes[0]
  check('橡皮工具提交擦除笔画', stroke !== undefined && stroke.tool === 'eraser')
  check('橡皮直径 130 换算为存储 size 50', stroke !== undefined && Math.abs(stroke.size - 50) < 0.01, JSON.stringify(stroke?.size))
}

/* 7. 橡皮光标预览圆：直径 = 世界直径 × 缩放 */
{
  const { handlers, cursor } = mountCanvas({ tool: 'eraser', penOnly: true, eraserDiameter: 40, camera: { x: 0, y: 0, scale: 2 } })
  handlers.onPointerMove(pointer('pointermove', { pointerType: 'mouse', pointerId: 71, clientX: 200, clientY: 150, buttons: 0 }))
  check('橡皮光标显示为圆形预览', cursor !== null && cursor !== undefined && cursor.style.display === 'block', JSON.stringify(cursor?.style))
  check('光标直径随缩放换算（40 × 2 = 80px）', cursor?.style.width === '80px' && cursor?.style.height === '80px', cursor?.style.width)
  check('光标跟随指针位置', cursor?.style.transform === 'translate(160px,110px)', cursor?.style.transform)
  const pen = mountCanvas({ tool: 'pen', penOnly: true, eraserDiameter: 40 })
  pen.handlers.onPointerMove(pointer('pointermove', { pointerType: 'mouse', pointerId: 72, clientX: 100, clientY: 100, buttons: 0 }))
  check('非橡皮工具隐藏橡皮光标', pen.cursor?.style.display === 'none', pen.cursor?.style.display)
}

/* 8. 纯函数换算：橡皮直径夹紧 / 宿主能力上限 / 单指平移 / 双指缩放中点锚定 */
{
  check('橡皮直径 26 → 存储 size 10', I.eraserStrokeSize(26) === 10, String(I.eraserStrokeSize(26)))
  check('旧宿主（size 上限 60）时大橡皮夹紧到 size 60', I.eraserStrokeSize(9999) === 60, String(I.eraserStrokeSize(9999)))
  check('新宿主（size 上限 300）时直径 400 存成 size 153.8', I.eraserStrokeSize(400, 300) === 153.8, String(I.eraserStrokeSize(400, 300)))
  check('橡皮直径低于下限被夹紧到 6', I.eraserStrokeSize(-5) === 2.3, String(I.eraserStrokeSize(-5)))
  check('旧宿主直径上限 156', I.eraserDiameterLimit(60) === 156, String(I.eraserDiameterLimit(60)))
  check('新宿主直径上限 400（不小于旧上限）', I.eraserDiameterLimit(300) === 400, String(I.eraserDiameterLimit(300)))
  check('未拿到宿主上限时按旧上限兜底', I.eraserDiameterLimit(undefined) === 156, String(I.eraserDiameterLimit(undefined)))
  const panned = I.panCamera({ x: 100, y: 50, scale: 2 }, 40, -20)
  check('单指平移换算：x/y 反向 ÷ 缩放', panned.x === 80 && panned.y === 60 && panned.scale === 2, JSON.stringify(panned))
  const pinched = I.pinchCamera(
    { camera: { x: 0, y: 0, scale: 1 }, startDistance: 100, startMid: { x: 50, y: 50 } },
    200,
    { x: 50, y: 50 },
  )
  check('双指缩放换算：2 倍且中点世界坐标不动', pinched.scale === 2 && pinched.x === 25 && pinched.y === 25, JSON.stringify(pinched))
  const capped = I.pinchCamera(
    { camera: { x: 0, y: 0, scale: 1 }, startDistance: 100, startMid: { x: 50, y: 50 } },
    100000,
    { x: 50, y: 50 },
  )
  check('双指缩放上限 8 倍', capped.scale === 8, String(capped.scale))
  const floor = I.pinchCamera(
    { camera: { x: 0, y: 0, scale: 1 }, startDistance: 100, startMid: { x: 50, y: 50 } },
    0.01,
    { x: 50, y: 50 },
  )
  check('双指缩放下限 0.08 倍', floor.scale === 0.08, String(floor.scale))
}

/* 9. 工具栏橡皮大小控件：渲染 + 拖动换算 + 键盘微调 */
{
  const changes = []
  const tree = I.EraserSizeControl({ value: 78, max: 150, onChange: (next) => changes.push(next) })
  let label = false
  let track = null
  const collect = (node) => {
    if (node === null || node === undefined) return
    if (typeof node === 'string') { if (node === '橡皮大小') label = true; return }
    if (Array.isArray(node)) { for (const item of node) collect(item); return }
    if (typeof node !== 'object' || node.props === undefined) return
    if (node.props.ref !== undefined && node.props.ref !== null) node.props.ref.current = makeDomNode(node.type)
    if (node.props.className === 'wb-slider') track = node.props
    collect(node.children)
  }
  collect(tree)
  check('工具栏渲染「橡皮大小」拖动滑块', label === true && track !== null)
  track.onPointerDown(pointer('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 72, buttons: 1 }))
  check('拖动滑块到 75% → 橡皮直径 114', changes[0] === 114, String(changes[0]))
  track.onKeyDown({ key: 'ArrowRight', preventDefault() {} })
  check('键盘 → 微调橡皮直径（+4）', changes[1] === 82, String(changes[1]))
}

/* 10. 编辑器整体渲染：两行工具按钮 / 橡皮滑块 / 仅手写笔开关 */
{
  const tree = I.EditorView({ board: { id: 'board-1', title: '测试白板', strokes: [], background: 'grid' }, eraserSizeMax: 300, onBack: () => {} })
  let hasSlider = false
  let hasPenOnly = false
  let hasToolsGrid = false
  let hasPaintColumn = false
  let hasOpsColumn = false
  let opsRowCount = 0
  let swatchCount = 0
  let hasFitButton = false
  let toolLabelCount = 0
  let dividerCount = 0
  let opsSegTitles = []
  let sliderMax = null
  const collect = (node) => {
    if (node === null || node === undefined) return
    if (typeof node === 'string') { if (node === '仅手写笔' || node === '允许手指') hasPenOnly = true; return }
    if (Array.isArray(node)) { for (const item of node) collect(item); return }
    if (typeof node !== 'object' || node.props === undefined) return
    if (typeof node.type === 'function') { collect(node.type(node.props)); return }
    if (node.props.ref !== undefined && node.props.ref !== null) node.props.ref.current = makeDomNode(node.type)
    if (node.props.className === 'wb-tools') hasToolsGrid = true
    if (node.props.className === 'wb-paint') hasPaintColumn = true
    if (node.props.className === 'wb-ops') hasOpsColumn = true
    if (node.props.className === 'wb-tool-label') toolLabelCount += 1
    if (node.props.className === 'wb-div') dividerCount += 1
    if (node.props.className === 'wb-fitbtn') hasFitButton = true
    if (typeof node.props.className === 'string' && node.props.className.split(' ')[0] === 'wb-swatch') swatchCount += 1
    if (node.props.className === 'wb-slider') { hasSlider = true; sliderMax = node.props['aria-valuemax'] }
    if (node.props.className === 'wb-ops') {
      const rows = (node.children ?? []).filter((child) => child && child.props && typeof child.props.className === 'string' && child.props.className.split(' ').includes('wb-row'))
      opsRowCount = rows.length
      opsSegTitles = []
      for (const row of rows) {
        for (const seg of row.children ?? []) {
          if (seg === null || seg === undefined || seg.props === undefined || seg.props.className !== 'wb-seg') continue
          opsSegTitles.push((seg.children ?? []).filter((btn) => btn && btn.props).map((btn) => String(btn.props.title ?? '')).join('|'))
        }
      }
    }
    collect(node.children)
  }
  collect(tree)
  check('工具栏分为三栏（工具 / 笔刷属性 / 其他操作）', hasToolsGrid === true && hasPaintColumn === true && hasOpsColumn === true)
  check('编辑器工具栏使用两行工具按钮（3 列网格）', hasToolsGrid === true)
  check('六个工具按钮都有图标 + 文字', toolLabelCount === 6, String(toolLabelCount))
  check('颜色扩到 12 个（单放一行）', swatchCount === 12, String(swatchCount))
  check('其他操作栏分两行', opsRowCount === 2, String(opsRowCount))
  check('操作栏含缩放与适配', hasFitButton === true)
  check('属性与操作分组之间用分隔线隔开', dividerCount === 4, String(dividerCount))
  check('网格与删除按钮各自独立成组', (() => {
    const gridSeg = opsSegTitles.findIndex((titles) => titles.includes('背景'))
    const trashSeg = opsSegTitles.findIndex((titles) => titles.includes('删除全部笔画'))
    return gridSeg >= 0 && trashSeg >= 0 && gridSeg !== trashSeg
  })(), JSON.stringify(opsSegTitles))
  check('编辑器工具栏渲染橡皮大小滑块', hasSlider === true)
  check('宿主支持大橡皮时滑块上限 400', sliderMax === 400, String(sliderMax))
  check('编辑器工具栏渲染仅手写笔开关', hasPenOnly === true)
}

console.log(failures === 0 ? '\nALL WHITEBOARD GESTURE TESTS PASSED' : `\n${failures} WHITEBOARD GESTURE TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
