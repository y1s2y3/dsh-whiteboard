/**
 * 离线渲染白板编辑器工具栏的 HTML 预览（不依赖 DSH 宿主）。
 * 用法：node tests/preview-toolbar.mjs [输出 html 路径]
 * 生成的页面用真实 CSS + 真实组件树渲染，便于在浏览器里检查排版/字号/两行按钮效果。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const out = path.resolve(process.argv[2] ?? path.join(root, '..', 'browser-screenshots', 'preview-toolbar.html'))

const code = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
let definition = null
const windows = {
  __ModuleLoader__: { load: (value) => { definition = value } },
  devicePixelRatio: 1,
  localStorage: { getItem: () => null, setItem: () => {} },
  setTimeout: () => 0,
  clearTimeout: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  confirm: () => true,
}
new Function('window', code)(windows)

const ReactShim = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (factory) => factory,
}
const moduleExports = definition.factory((name) => {
  if (name === 'react') return ReactShim
  throw new Error('unexpected require: ' + name)
})
const I = moduleExports.__internals

const HTML_ATTRS = {
  className: 'class',
  strokeWidth: 'stroke-width',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  tabIndex: 'tabindex',
  ariaHidden: 'aria-hidden',
  ariaLabel: 'aria-label',
  viewBox: 'viewBox',
  strokeDasharray: 'stroke-dasharray',
  xmlnsXlink: 'xmlns:xlink',
}
const UNITLESS = new Set(['opacity', 'flex', 'zIndex', 'fontWeight', 'lineHeight', 'flexGrow', 'flexShrink', 'order'])

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;')
}

function styleOf(object) {
  return Object.entries(object).map(([key, value]) => {
    const name = key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())
    const unit = typeof value === 'number' && !UNITLESS.has(key) ? 'px' : ''
    return name + ':' + value + unit
  }).join(';')
}

function toHtml(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return escapeText(node)
  if (Array.isArray(node)) return node.map(toHtml).join('')
  if (typeof node !== 'object') return ''
  if (typeof node.type === 'function') return toHtml(node.type(node.props))
  const tag = node.type
  const props = node.props ?? {}
  let attrs = ''
  for (const [rawKey, value] of Object.entries(props)) {
    if (rawKey === 'ref' || rawKey === 'key' || rawKey === 'children') continue
    if (typeof value === 'function') continue
    if (value === undefined || value === null || value === false) continue
    const key = HTML_ATTRS[rawKey] ?? rawKey
    if (key === 'style' && typeof value === 'object') {
      attrs += ` style="${escapeAttr(styleOf(value))}"`
      continue
    }
    if (key === 'className') {
      attrs += ` class="${escapeAttr(value)}"`
      continue
    }
    if (key === 'disabled' || key === 'checked') {
      attrs += ' ' + key
      continue
    }
    attrs += ` ${key}="${escapeAttr(String(value))}"`
  }
  const children = (node.children ?? []).map(toHtml).join('')
  const voidTags = new Set(['img', 'input', 'br', 'hr'])
  if (voidTags.has(tag)) return `<${tag}${attrs}>`
  return `<${tag}${attrs}>${children}</${tag}>`
}

const board = {
  id: 'preview',
  title: '示例白板 · 手写测试',
  strokes: [],
  background: 'grid',
}
const editor = toHtml(I.EditorView({ board, eraserSizeMax: 300, onBack: () => {} }))

const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>手写白板工具栏预览</title>
<style>
html,body{height:100%;margin:0;background:#EEF2F8;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#0F172A}
#stage{height:100vh;display:flex;flex-direction:column}
${I.CSS}
</style></head>
<body><div id="stage"><div class="wb-root">${editor}</div></div></body></html>`

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, page, 'utf8')
console.log('preview -> ' + out)
