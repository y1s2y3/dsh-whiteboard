/**
 * dsh-whiteboard 离线测试：存储归一化、路由 CRUD、客户端入口。
 * 运行：node whiteboard/tests/smoke-whiteboard.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'))
process.env.DSH_HOME = home

const storeLib = await import(pathToFileURL(path.join(root, 'lib', 'store.js')).href)
const serverLib = await import(pathToFileURL(path.join(root, 'lib', 'server.js')).href)
const updateLib = await import(pathToFileURL(path.join(root, 'lib', 'update-check.js')).href)

let failures = 0
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  ← ' + detail}`)
  if (!condition) failures += 1
}

/* 1. 存储归一化与 CRUD */
{
  const store = new storeLib.WhiteboardStore()
  await store.load()
  check('初始列表为空', store.list().length === 0)
  const created = await store.create('测试白板')
  check('新建白板返回 id 与默认标题', typeof created.id === 'string' && created.title === '测试白板' && created.strokes.length === 0)
  const saved = await store.save(created.id, {
    strokes: [
      { tool: 'pen', color: '#ef4444', size: 4, points: [[160, 200, 0.5], [320, 300, 0.6]] },
      { tool: 'brush', color: 'bad-color', size: 999, points: [[300, 400, 0.5], [400, 500, 0.7]] },
      { tool: 'pen', color: '#000000', size: 4, points: [[500, 500]] },
      { tool: 'eraser', color: '#000000', size: 10, points: [[180, 220, 0.5], [190, 230, 0.5]] },
      { tool: 'eraser', color: '#000000', size: 200, points: [[600, 600, 0.5], [640, 640, 0.5]] },
    ],
    thumbnail: 'data:image/png;base64,' + 'A'.repeat(64),
    background: 'blank',
    view: { x: -50, y: -20, scale: 1.5 },
  })
  check('保存笔画并过滤无效笔画', saved.strokes.length === 4, JSON.stringify(saved.strokes.map((stroke) => stroke.tool)))
  check('非法颜色回退、粗细被限制', saved.strokes[1].color === '#1f2937' && saved.strokes[1].size <= 60, JSON.stringify(saved.strokes[1]))
  check('世界坐标保留负值与压感', saved.strokes[0].points[0][0] === 160 && saved.coords === 'world')
  check('橡皮笔画被保存（像素级擦除）', saved.strokes.some((stroke) => stroke.tool === 'eraser'))
  check('大橡皮 size 200 不被旧上限 60 截断', saved.strokes.some((stroke) => stroke.tool === 'eraser' && Math.abs(stroke.size - 200) < 0.01), JSON.stringify(saved.strokes.filter((stroke) => stroke.tool === 'eraser').map((stroke) => stroke.size)))
  check('视图（平移/缩放）被保存', saved.view?.x === -50 && saved.view?.scale === 1.5, JSON.stringify(saved.view))
  check('背景与缩略图保存', saved.background === 'blank' && saved.thumbnail.startsWith('data:image/png'))
  const legacy = storeLib.normalizeDocument({
    boards: [{
      id: 'legacy-board', title: '旧白板', coords: undefined,
      strokes: [{ tool: 'pen', color: '#1f2937', size: 4, points: [[0.1, 0.2, 0.5], [0.2, 0.3, 0.5]] }],
    }],
  })
  check('旧版 0~1 坐标自动迁移到世界坐标', legacy.boards[0].coords === 'world' && legacy.boards[0].strokes[0].points[0][0] === 160 && legacy.boards[0].strokes[0].points[0][1] === 200, JSON.stringify(legacy.boards[0].strokes[0].points[0]))
  const list = store.list()
  check('列表返回元数据（不含笔画）', list.length === 1 && list[0].strokeCount === 4 && list[0].strokes === undefined, JSON.stringify(list[0]))
  const fetched = store.get(created.id)
  check('按 id 读取完整白板', fetched !== null && fetched.strokes.length === 4)
  const renamed = await store.rename(created.id, '改名后的白板')
  check('重命名生效', renamed.title === '改名后的白板')
  const removed = await store.remove(created.id)
  check('删除白板', removed !== null && store.get(created.id) === null)
  check('数据文件已落盘', fs.existsSync(store.file))
}

/* 1.5 版本更新检查 */
{
  const { compareVersions, checkForUpdate, resetUpdateCache, CURRENT_VERSION, UPDATE_REPO } = updateLib
  check('版本比较：0.5.0 > 0.4.9', compareVersions('0.5.0', '0.4.9') === 1)
  check('版本比较：相等（忽略 v 前缀）', compareVersions('v0.5.0', '0.5.0') === 0)
  check('版本比较：0.4.3 < 0.5.0', compareVersions('0.4.3', '0.5.0') === -1)
  check('更新检查仓库指向 GitHub 仓库', UPDATE_REPO === 'y1s2y3/dsh-whiteboard', UPDATE_REPO)
  check('当前版本来自 package.json', /^\d+\.\d+\.\d+/.test(CURRENT_VERSION), CURRENT_VERSION)
  const fakeFetch = (payload) => async () => ({ ok: true, json: async () => payload })
  resetUpdateCache()
  const newer = await checkForUpdate({ force: true, fetcher: fakeFetch({ tag_name: 'v0.6.0' }) })
  check('检查更新：发现新版本', newer.ok === true && newer.hasUpdate === true && newer.latest === '0.6.0' && newer.source === 'github', JSON.stringify(newer))
  resetUpdateCache()
  const same = await checkForUpdate({ force: true, fetcher: fakeFetch({ tag_name: 'v' + CURRENT_VERSION }) })
  check('检查更新：已是最新版本', same.ok === true && same.hasUpdate === false, JSON.stringify(same))
  resetUpdateCache()
  const failing = await checkForUpdate({ force: true, fetcher: async () => { throw new Error('offline') } })
  check('检查更新：网络失败时返回可读错误（不抛异常）', failing.ok === false && typeof failing.error === 'string' && failing.error.length > 0, JSON.stringify(failing))
  resetUpdateCache()
}

/* 2. 路由 CRUD */
{
  let handler = null
  const ctx = { webServer: { register: (route) => { handler = route.handler; return () => {} } } }
  const store = new storeLib.WhiteboardStore()
  const fakeUpdate = async () => ({
    ok: true,
    current: updateLib.CURRENT_VERSION,
    latest: '0.6.0',
    hasUpdate: true,
    url: 'https://github.com/y1s2y3/dsh-whiteboard/releases/latest',
    source: 'github',
    error: null,
  })
  serverLib.registerRoutes(ctx, { store, logger: console, updateChecker: fakeUpdate })
  check('路由注册成功', typeof handler === 'function')

  async function call(method, url, body) {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
    const req = {
      method,
      url,
      async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
    }
    let status = 0
    let payload = null
    const res = {
      statusCode: 0,
      setHeader() {},
      end(text) { status = this.statusCode; payload = JSON.parse(text) },
    }
    await handler(req, res)
    return { status, payload }
  }

  const empty = await call('GET', '/dsh-whiteboard/boards')
  check('GET /boards 返回空列表', empty.status === 200 && empty.payload.ok === true && empty.payload.boards.length === 0)
  check('GET /boards 声明橡皮 size 上限 300', empty.payload.eraserSizeMax === 300, String(empty.payload.eraserSizeMax))
  check('GET /boards 返回版本号与仓库', empty.payload.version === updateLib.CURRENT_VERSION && empty.payload.repo === 'y1s2y3/dsh-whiteboard', `${empty.payload.version}/${empty.payload.repo}`)
  const created = await call('POST', '/dsh-whiteboard/boards', { title: '路由白板' })
  const id = created.payload.board.id
  check('POST /boards 新建成功', created.status === 200 && created.payload.board.title === '路由白板', JSON.stringify(created.payload.board).slice(0, 120))
  const saved = await call('PUT', '/dsh-whiteboard/boards/' + id, {
    title: '路由白板 2',
    strokes: [{ tool: 'pencil', color: '#22c55e', size: 3, points: [[0.2, 0.2, 0.5], [0.3, 0.3, 0.5]] }],
    background: 'grid',
  })
  check('PUT /boards/:id 保存成功', saved.status === 200 && saved.payload.board.strokes.length === 1)
  const loaded = await call('GET', '/dsh-whiteboard/boards/' + id)
  check('GET /boards/:id 读取成功', loaded.status === 200 && loaded.payload.board.title === '路由白板 2')
  const renamed = await call('PATCH', '/dsh-whiteboard/boards/' + id, { title: '改名' })
  check('PATCH /boards/:id 只改标题', renamed.status === 200 && renamed.payload.board.title === '改名' && renamed.payload.board.strokes.length === 1)
  const health = await call('GET', '/dsh-whiteboard/health')
  check('健康检查返回插件名', health.status === 200 && health.payload.plugin === 'dsh-whiteboard')
  check('健康检查声明橡皮 size 上限', health.payload.eraserSizeMax === 300, String(health.payload.eraserSizeMax))
  check('健康检查返回版本号', health.payload.version === updateLib.CURRENT_VERSION, String(health.payload.version))
  const update = await call('GET', '/dsh-whiteboard/update-check')
  check('GET /update-check 返回最新版本与下载地址', update.status === 200 && update.payload.ok === true && update.payload.latest === '0.6.0' && update.payload.hasUpdate === true && String(update.payload.url).includes('releases/latest'), JSON.stringify(update.payload))
  const updateForced = await call('GET', '/dsh-whiteboard/update-check?force=1')
  check('GET /update-check?force=1 可用', updateForced.status === 200 && updateForced.payload.ok === true)
  const removed = await call('DELETE', '/dsh-whiteboard/boards/' + id)
  check('DELETE /boards/:id 删除成功', removed.status === 200 && removed.payload.ok === true)
  const missing = await call('GET', '/dsh-whiteboard/boards/' + id)
  check('读取已删除白板返回 404', missing.status === 404)
  const badBody = await call('PUT', '/dsh-whiteboard/boards/nope', {})
  check('保存不存在白板返回 404', badBody.status === 404)
}

/* 3. 客户端实现检查 */
{
  const client = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  check('注册侧栏面板与主面板', client.includes("name: 'sidebar.panellist'") && client.includes("key: 'whiteboard'") && client.includes("label: '手写白板'"))
  check('列表展示历史白板并可继续编辑', client.includes('我的白板') && client.includes('点击继续编辑') && client.includes("'/boards/' + encodeURIComponent(id)"))
  check('五种笔型', ['铅笔', '钢笔', '毛笔', '马克笔', '橡皮'].every((label) => client.includes(label)))
  check('颜色与粗细选择', client.includes('COLORS') && client.includes('widths') && client.includes('wb-swatch') && client.includes('wb-width'))
  check('支持数位笔压感', client.includes('event.pressure') && client.includes('pointerType'))
  check('笔上橡皮按钮/侧键按住临时擦除', client.includes('penEraserActive') && client.includes('event.button === 5') && client.includes('buttons & 32') && client.includes('buttons & 2'))
  check('默认仅手写笔：手指触摸不画线', client.includes("event.pointerType === 'touch'") && client.includes('仅手写笔') && client.includes('penOnly'))
  check('手掌/多指防误触：只认当前 pointerId', client.includes('pointerId') && client.includes('event.pointerId !== live.pointerId') && client.includes('current.pointerId !== event.pointerId'))
  check('撤销/重做/清空/导出', client.includes('撤销') && client.includes('重做') && client.includes('清空') && client.includes('导出 PNG'))
  check('无限画布：相机平移/缩放/适配', client.includes('applyCamera') && client.includes('fitCamera') && client.includes('renderGrid') && client.includes('wheel') && client.includes('id: \'hand\''))
  check('双指缩放/平移手势', client.includes('touchesRef') && client.includes('gestureRef') && client.includes('startDistance') && client.includes('applyTouchGesture') && client.includes('双指缩放'))
  check('单指拖动平移画布（仅手写笔模式下手指不画线）', client.includes('startSinglePan') && client.includes('panCamera') && client.includes('单指拖动'))
  check('橡皮擦大小可拖动调整（滑块 + 光标预览）', client.includes('EraserSizeControl') && client.includes('wb-slider') && client.includes('wb-eraser-cursor') && client.includes("'dsh-whiteboard:eraser-diameter'"))
  check('橡皮直径与旧存储 size 兼容换算', client.includes('ERASER_WIDTH_FACTOR') && client.includes('eraserStrokeSize'))
  check('工具按钮两行网格（3 列）+ 图标', client.includes("className: 'wb-tools'") && client.includes('ToolIcon') && client.includes("'wb-tool-label'") && client.includes('grid-template-columns:repeat(3'))
  check('工具栏三栏分组（工具 / 笔刷属性 / 其他操作）', client.includes("className: 'wb-tools'") && client.includes("className: 'wb-paint'") && client.includes("className: 'wb-ops'") && client.includes("className: 'wb-div'"))
  const headIndex = client.indexOf("className: 'wb-editor-head'")
  const chipIndex = client.indexOf("className: 'wb-chip'")
  const toolbarIndex = client.indexOf("className: 'wb-toolbar'")
  check('仅手写笔开关移到标题栏', headIndex >= 0 && chipIndex > headIndex && chipIndex < toolbarIndex, `${headIndex}/${chipIndex}/${toolbarIndex}`)
  check('橡皮大小上限 400 且按宿主能力兜底', client.includes('ERASER_DIAMETER_MAX = 400') && client.includes('ERASER_SIZE_MAX_FALLBACK') && client.includes('eraserDiameterLimit'))
  check('客户端读取宿主声明的橡皮上限', client.includes('payload.eraserSizeMax'))
  check('版本与检查更新 UI（只提示不自动安装）', client.includes('检查更新') && client.includes("'/update-check") && client.includes('wb-update') && client.includes('hasUpdate') && client.includes('不会丢'))
  const storeSource = fs.readFileSync(path.join(root, 'lib', 'store.js'), 'utf8')
  check('宿主声明橡皮 size 上限 300', storeSource.includes('MAX_ERASER_SIZE = 300'))
  check('像素级橡皮：destination-out 只擦内容', client.includes("globalCompositeOperation = 'destination-out'") && client.includes("stroke.tool === 'eraser'"))
  check('旧版固定画布常量已移除', !client.includes('BOARD_WIDTH') && !client.includes('BOARD_HEIGHT'))
  check('自动保存（防抖 PUT）', client.includes('SAVE_DEBOUNCE_MS') && client.includes("method: 'PUT'"))
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  check('包声明 client 与 bundle patch', pkg.dsh?.client?.platform === 'web' && pkg.dsh?.bundle?.patch === './cordis.patch.yml')
  check('包声明仓库 / 主页 / 许可证 / 关键词', String(pkg.repository?.url).includes('github.com/y1s2y3/dsh-whiteboard') && String(pkg.homepage).includes('dsh-whiteboard') && pkg.license === 'MIT' && Array.isArray(pkg.keywords), JSON.stringify({ repo: pkg.repository, homepage: pkg.homepage }))
  check('包清单包含 INSTALL/PRIVACY/LICENSE', Array.isArray(pkg.files) && ['INSTALL.md', 'PRIVACY.md', 'LICENSE'].every((file) => pkg.files.includes(file)), JSON.stringify(pkg.files))
  const repoFiles = ['LICENSE', 'INSTALL.md', 'PRIVACY.md', 'deploy.mjs', 'package.mjs', '.gitignore', '.gitattributes', 'docs/RELEASE-NOTES-0.5.0.md', '.github/workflows/release.yml']
  const missing = repoFiles.filter((file) => !fs.existsSync(path.join(root, file)))
  check('发布相关文件齐全（LICENSE/INSTALL/PRIVACY/打包/工作流）', missing.length === 0, missing.join(','))
}

/* 4. 客户端 bundle 在模块加载器里能正常求值并注册两个 slot */
{
  const code = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  let loaded = null
  const fakeWindow = { __ModuleLoader__: { load: (definition) => { loaded = definition } } }
  new Function('window', code)(fakeWindow)
  check('客户端 bundle 通过 __ModuleLoader__ 注册自身', loaded !== null && loaded.id === 'dsh-whiteboard')
  const ReactShim = {
    createElement: () => ({}),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useMemo: (factory) => factory(),
    useCallback: (factory) => factory,
  }
  const moduleExports = loaded.factory((name) => {
    if (name === 'react') return ReactShim
    throw new Error('unexpected require: ' + name)
  })
  check('客户端导出 apply 与 inject', typeof moduleExports.apply === 'function' && Array.isArray(moduleExports.inject))
  check('暴露离线测试内部函数（手势/橡皮换算）', typeof moduleExports.__internals?.panCamera === 'function' && typeof moduleExports.__internals?.CanvasBoard === 'function')
  const registrations = []
  const ctx = {
    slots: {
      inject: (name, callback) => { registrations.push(name); callback() },
      register: (definition) => { registrations.push(definition.name + ':' + (definition.id ?? definition.key)); return () => {} },
    },
  }
  moduleExports.apply(ctx)
  check('注册侧栏与主面板两个 slot', registrations.includes('sidebar.panellist') && registrations.includes('main:whiteboard'), registrations.join(','))
}

/* 5. 宿主插件 apply 能注册路由 */
{
  const indexLib = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href)
  let routeCount = 0
  const fakeCtx = {
    logger: console,
    effect: (fn) => { fn() },
    webServer: { register: () => { routeCount += 1; return () => {} } },
  }
  indexLib.apply(fakeCtx)
  check('宿主 apply 注册 /dsh-whiteboard 前缀路由', routeCount === 1)
  check('插件导出 name/inject', indexLib.name === 'whiteboard' && Array.isArray(indexLib.inject) && indexLib.inject.includes('webServer'))
}

console.log(failures === 0 ? '\nALL WHITEBOARD TESTS PASSED' : `\n${failures} WHITEBOARD TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
