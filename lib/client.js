/**
 * Browser half of dsh-whiteboard（手写白板）。
 *
 * 贡献两个 slot：
 * - `sidebar.panellist`：笔形图标 +「手写白板」；
 * - `main` key `whiteboard`：历史白板列表 + 画布编辑器。
 *
 * 数据来自宿主半的 `/dsh-whiteboard` JSON API；画布用原生 Canvas 2D，
 * 笔画以归一化坐标（0~1）保存，与显示尺寸无关。
 */
window.__ModuleLoader__.load({
  id: 'dsh-whiteboard',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const API = '/dsh-whiteboard'
    /** 无限画布的世界坐标（像素）；旧版是 0~1 归一化，由宿主迁移成世界坐标。 */
    const MIN_SCALE = 0.08
    const MAX_SCALE = 8
    const GRID_STEP = 40
    const DEFAULT_BOUNDS = { x: 0, y: 0, w: 1600, h: 1000 }
    const THUMB_WIDTH = 320
    const THUMB_HEIGHT = 200
    const MAX_HISTORY = 50
    const SAVE_DEBOUNCE_MS = 900
    /**
     * 橡皮擦直径（世界坐标 px）的拖动范围。
     * 宿主存储沿用旧公式「渲染线宽 = size × 2.6」，所以这里存回 size 时会除以该系数。
     * 宿主对 size 的上限：新版 300（直径 780），旧宿主仍是 60（直径 156）——
     * 客户端会先读接口返回的 eraserSizeMax，没拿到就按旧上限兜底，避免大橡皮被宿主截断。
     */
    const ERASER_DIAMETER_MIN = 6
    const ERASER_DIAMETER_MAX = 400
    const ERASER_DIAMETER_DEFAULT = 36
    const ERASER_WIDTH_FACTOR = 2.6
    const ERASER_SIZE_MAX_LATEST = 300
    const ERASER_SIZE_MAX_FALLBACK = 60
    const ERASER_DIAMETER_KEY = 'dsh-whiteboard:eraser-diameter'

    const COLORS = [
      '#1f2937', '#000000', '#64748b', '#ef4444', '#ec4899', '#f97316',
      '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7',
    ]
    const WIDTHS = [2, 4, 8, 14]
    const TOOLS = [
      { id: 'pencil', label: '铅笔', hint: '轻微颗粒感，适合草稿' },
      { id: 'pen', label: '钢笔', hint: '顺滑均匀，适合写笔记' },
      { id: 'brush', label: '毛笔', hint: '随压感/运笔粗细变化' },
      { id: 'marker', label: '马克笔', hint: '半透明宽笔，适合标注' },
      { id: 'eraser', label: '橡皮', hint: '像素级擦除（只擦掉划过的部分）；大小可用工具栏滑块拖动调整' },
      { id: 'hand', label: '抓手', hint: '拖动画布平移；仅手写笔模式下单指拖动也能平移' },
    ]

    const CSS = `
.wb-root{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#F5F7FB);color:var(--dsw-alias-label-primary,#0F172A);font-size:13px}
.wb-root *{box-sizing:border-box}
.wb-header{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#E6EBF3);background:var(--dsw-alias-bg-l1,#FFFFFF);flex:none}
.wb-header-title{font-size:15px;font-weight:600;white-space:nowrap}
.wb-header-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary,#8A94A6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wb-spacer{flex:1}
.wb-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid var(--dsw-alias-border-l2,#D7DFEA);background:var(--dsw-alias-bg-l1,#FFF);color:var(--dsw-alias-label-primary,#0F172A);border-radius:8px;padding:5px 10px;font:inherit;font-size:12.5px;line-height:18px;cursor:pointer;white-space:nowrap}
.wb-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#F3F6FB)}
.wb-btn:disabled{opacity:.45;cursor:default}
.wb-btn--primary{background:var(--dsw-alias-brand-primary,#2F6BFF);border-color:transparent;color:#fff}
.wb-btn--primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary,#2F6BFF);opacity:.9}
.wb-btn--danger{color:#DC2626;border-color:#F3C9C9;background:#FFF7F7}
.wb-btn--sm{padding:3px 8px;font-size:12px;border-radius:7px}
.wb-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid transparent;background:transparent;border-radius:7px;color:var(--dsw-alias-label-secondary,#8A94A6);cursor:pointer}
.wb-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover,#F1F5F9);color:var(--dsw-alias-label-primary,#0F172A)}
.wb-body{flex:1;min-height:0;overflow:auto;padding:14px}
.wb-list{max-width:1120px;margin:0 auto}
.wb-list-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.wb-version{font-size:11.5px;color:#94A3B8;font-variant-numeric:tabular-nums}
.wb-update{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:-2px 0 12px;padding:8px 11px;border:1px solid #E3EAF4;background:#FFF;border-radius:10px;font-size:12px;color:#475569}
.wb-update--new{border-color:#A9C1F8;background:#F2F7FF}
.wb-update--error{border-color:#F3C9C9;background:#FFF7F7;color:#B91C1C}
.wb-update-hint{font-size:11.5px;color:#8A94A6}
.wb-link{color:#1D4ED8;font-weight:500;text-decoration:none;white-space:nowrap}
.wb-link:hover{text-decoration:underline}
.wb-list-title{font-size:14px;font-weight:600}
.wb-list-count{font-size:12px;color:var(--dsw-alias-label-secondary,#8A94A6)}
.wb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.wb-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1,#E6EBF3);background:var(--dsw-alias-bg-l1,#FFF);border-radius:12px;padding:10px;cursor:pointer;text-align:left;font:inherit;color:inherit;transition:box-shadow .12s ease,border-color .12s ease}
.wb-card:hover{border-color:#BFD3FF;box-shadow:0 6px 18px rgba(47,107,255,.10)}
.wb-card-thumb{position:relative;width:100%;aspect-ratio:8/5;border-radius:8px;overflow:hidden;background:#FBFCFE;border:1px solid #EDF1F7;display:flex;align-items:center;justify-content:center}
.wb-card-thumb img{width:100%;height:100%;object-fit:contain;display:block;background:#fff}
.wb-card-thumb-empty{font-size:24px;color:#C8D2E1}
.wb-card-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wb-card-meta{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#8A94A6)}
.wb-card-actions{display:flex;gap:4px;justify-content:flex-end}
.wb-empty{padding:48px 16px;text-align:center;color:var(--dsw-alias-label-secondary,#8A94A6);background:#FFF;border:1px dashed #DCE4F0;border-radius:14px;display:flex;flex-direction:column;align-items:center;gap:12px}
.wb-empty-mark{font-size:34px;line-height:1}
.wb-editor{height:100%;display:flex;flex-direction:column;min-height:0}
.wb-editor-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #E9EEF7;background:#FFF;flex:none;flex-wrap:wrap}
.wb-title-input{flex:1;min-width:120px;max-width:420px;border:1px solid transparent;background:transparent;border-radius:7px;padding:4px 7px;font:inherit;font-size:14px;font-weight:600;color:#0F172A}
.wb-title-input:hover{border-color:#E1E8F3;background:#FBFCFE}
.wb-title-input:focus{outline:none;border-color:#2F6BFF;background:#FFF;box-shadow:0 0 0 3px rgba(47,107,255,.13)}
.wb-save{font-size:11.5px;color:var(--dsw-alias-label-secondary,#8A94A6);min-width:62px;text-align:right}
.wb-toolbar{display:flex;align-items:stretch;padding:10px 12px;border-bottom:1px solid #E9EEF7;background:linear-gradient(180deg,#FBFCFE,#F6F9FF);flex:none;flex-wrap:wrap}
.wb-tools{display:grid;grid-template-columns:repeat(3,minmax(78px,1fr));gap:6px;padding:6px;border:1px solid #E3EAF4;background:#FFF;border-radius:12px;box-shadow:0 1px 2px rgba(15,23,42,.04);flex:none;width:330px}
.wb-tool{display:flex;align-items:center;justify-content:center;gap:6px;height:40px;padding:0 8px;border:1px solid #E6ECF6;background:#FBFCFE;color:#475569;border-radius:9px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;transition:background .12s ease,border-color .12s ease,color .12s ease,box-shadow .12s ease,transform .1s ease}
.wb-tool:hover{border-color:#BED2F8;background:#F3F7FF;color:#1D4ED8}
.wb-tool:active{transform:translateY(1px)}
.wb-tool--on{border-color:#8FB0F6;background:#EAF1FF;color:#1D4ED8;box-shadow:0 1px 3px rgba(47,107,255,.16)}
.wb-tool-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px}
.wb-tool-label{overflow:hidden;text-overflow:ellipsis}
/* 三栏：①工具 ②颜色/粗细/橡皮 ③其他操作（两行） */
.wb-paint{display:flex;flex-direction:column;justify-content:center;gap:8px;flex:none;width:420px;min-width:0;margin-left:14px;padding:0 14px;border-left:1px solid #E7EDF7}
.wb-ops{display:flex;flex-direction:column;justify-content:center;gap:8px;flex:1;min-width:250px;padding-left:14px;border-left:1px solid #E7EDF7}
.wb-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.wb-row--end{justify-content:flex-end}
.wb-fitbtn{height:34px;padding:0 12px;border:1px solid #E3EAF4;background:#FFF;border-radius:10px;color:#475569;font:inherit;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;transition:background .12s ease,border-color .12s ease,color .12s ease}
.wb-fitbtn:hover{background:#F4F8FF;border-color:#C7D8F5;color:#1D4ED8}
.wb-paint .wb-swatches{width:100%;justify-content:space-between}
.wb-div{width:1px;height:20px;background:#E3EAF4;flex:none;margin:0 2px}
.wb-seg{display:inline-flex;align-items:center;gap:2px;height:34px;padding:1px;border:1px solid #E3EAF4;background:#FFF;border-radius:10px}
.wb-seg .wb-iconbtn{width:30px;height:30px}
.wb-seg .wb-zoom-label{height:30px}
.wb-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid #E3EAF4;background:#FFF;color:#475569;border-radius:999px;font:inherit;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;transition:background .12s ease,border-color .12s ease,color .12s ease}
.wb-chip:hover{background:#F4F8FF;border-color:#C7D8F5;color:#1D4ED8}
.wb-chip--on{background:#EAF1FF;border-color:#A9C1F8;color:#1D4ED8}
.wb-chip-dot{width:7px;height:7px;border-radius:50%;background:#94A3B8;flex:none}
.wb-chip--on .wb-chip-dot{background:#2F6BFF}
.wb-editor-head .wb-chip{margin-left:auto}
.wb-swatches{display:flex;align-items:center;gap:5px;height:34px;padding:0 9px;border:1px solid #E3EAF4;background:#FFF;border-radius:10px}
.wb-cap{font-size:11.5px;color:#94A3B8;white-space:nowrap;margin-right:1px}
.wb-swatch{width:20px;height:20px;border-radius:50%;border:2px solid #FFF;box-shadow:0 0 0 1px #D8E0EC;cursor:pointer;padding:0;transition:transform .1s ease}
.wb-swatch:hover{transform:scale(1.12)}
.wb-swatch--on{box-shadow:0 0 0 2px #2F6BFF}
.wb-widths{display:flex;align-items:center;gap:2px;height:34px;padding:0 6px;border:1px solid #E3EAF4;background:#FFF;border-radius:10px}
.wb-width{width:28px;height:28px;border:none;background:transparent;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.wb-width:hover{background:#F1F5F9}
.wb-width--on{background:#EAF1FF}
.wb-width i{display:block;border-radius:50%;background:#475569}
.wb-canvas-wrap{flex:1;min-height:0;background:#EEF2F8;display:flex;flex-direction:column;padding:14px 14px 0}
.wb-canvas-viewport{position:relative;flex:1;min-height:280px;border-radius:10px;overflow:hidden;background:#FFF;box-shadow:0 6px 22px rgba(15,23,42,.10)}
.wb-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none}
.wb-canvas--bg{pointer-events:none;background:#FFF}
.wb-canvas--content{background:transparent;cursor:crosshair}
.wb-canvas--eraser{cursor:none}
.wb-canvas--hand{cursor:grab}
.wb-canvas--panning{cursor:grabbing}
.wb-eraser-cursor{position:absolute;left:0;top:0;display:none;border-radius:50%;border:1.5px solid rgba(51,65,85,.85);background:rgba(148,163,184,.18);box-shadow:inset 0 0 0 1px rgba(255,255,255,.7);pointer-events:none;z-index:4}
.wb-eraser-box{display:flex;align-items:center;gap:6px;height:34px;flex:1;min-width:0;padding:0 9px;border:1px solid #E3EAF4;background:#FFF;border-radius:10px}
.wb-eraser-cap{font-size:12px;color:#475569;white-space:nowrap}
.wb-eraser-dot{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px}
.wb-eraser-dot i{display:block;border-radius:50%;background:#475569}
.wb-slider{position:relative;display:flex;align-items:center;flex:1;min-width:64px;height:22px;cursor:ew-resize;touch-action:none;user-select:none}
.wb-slider-rail{position:absolute;left:0;right:0;height:4px;border-radius:999px;background:#E2E8F0}
.wb-slider-fill{position:absolute;left:0;height:4px;border-radius:999px;background:#2F6BFF}
.wb-slider-thumb{position:absolute;top:50%;width:14px;height:14px;margin-top:-7px;border-radius:50%;background:#FFF;border:2px solid #2F6BFF;box-shadow:0 1px 3px rgba(15,23,42,.18);transform:translateX(-50%);pointer-events:none}
.wb-slider--on .wb-slider-thumb{background:#EAF1FF}
.wb-eraser-num{font-size:11.5px;color:#64748B;min-width:30px;text-align:right;font-variant-numeric:tabular-nums}
.wb-zoom-label{min-width:48px;height:26px;border:1px solid transparent;background:transparent;border-radius:7px;color:#64748B;font:inherit;font-size:11.5px;cursor:pointer}
.wb-zoom-label:hover{background:#F1F5F9;color:#0F172A}
.wb-tip{margin-top:8px;padding-bottom:6px;font-size:11.5px;color:#8A94A6;text-align:center}
.wb-loading{padding:40px;text-align:center;color:#8A94A6}
.wb-error{margin:10px auto;max-width:640px;border:1px solid #F4C7C7;background:#FEF2F2;color:#7F1D1D;border-radius:10px;padding:10px 12px;font-size:12.5px}
@media (max-width:1060px){
  .wb-paint,.wb-ops{flex:1 1 100%;width:auto;min-width:0;margin-left:0;padding-left:0;border-left:none;border-top:1px solid #E7EDF7;padding-top:10px;margin-top:4px}
}
@media (max-width:700px){.wb-swatch{width:18px;height:18px}.wb-eraser-cap{display:none}}
/* 侧栏「全局面板」入口（插件 / 会议纪要 / 自动化任务 / 手写白板）：图标和文字稍微放大一点。
   选择器带 html body 以提高优先级，确保覆盖会议插件注入的两列小号样式；折叠态仍由宿主 36×36 规则接管。 */
html body nav[aria-label="全局面板"] > button,
html body nav[aria-label="Global panels"] > button{
  padding:7px 8px;
  min-height:36px;
  gap:5px;
  font-size:14px;
  line-height:20px;
}
html body nav[aria-label="全局面板"] > button > span:first-child svg,
html body nav[aria-label="Global panels"] > button > span:first-child svg{
  width:18px;
  height:18px;
}
`

    const STYLE_TAG_ID = 'dsh-whiteboard/client.css'
    function ensureStyle() {
      if (typeof document === 'undefined') return
      // 已存在时同步更新内容：客户端热更新会重新 apply，但 index 页面不刷新时 style 标签仍在
      const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`)
      if (existing !== null) {
        if (existing.textContent !== CSS) existing.textContent = CSS
        return
      }
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-whiteboard'
      style.dataset.pluginCss = STYLE_TAG_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    async function requestJson(path, options = {}) {
      const response = await fetch(API + path, {
        method: options.method ?? 'GET',
        headers: { 'content-type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload === null || payload.ok !== true) {
        throw new Error(payload?.error ?? ('请求失败（HTTP ' + response.status + '）'))
      }
      return payload
    }

    function formatStamp(value) {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (number) => String(number).padStart(2, '0')
      const now = new Date()
      const sameDay = date.toDateString() === now.toDateString()
      return sameDay
        ? '今天 ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
        : (date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    function countStrokes(strokes) {
      return Array.isArray(strokes) ? strokes.length : 0
    }

    /* ---------------- 无限画布渲染 ---------------- */

    /** 计算所有可见笔画的包围盒（忽略橡皮），用于缩略图/导出/适配视图。 */
    function contentBounds(strokes) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const stroke of Array.isArray(strokes) ? strokes : []) {
        if (stroke.tool === 'eraser') continue
        for (const point of Array.isArray(stroke.points) ? stroke.points : []) {
          if (point[0] < minX) minX = point[0]
          if (point[1] < minY) minY = point[1]
          if (point[0] > maxX) maxX = point[0]
          if (point[1] > maxY) maxY = point[1]
        }
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
      return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
    }

    function strokeWidthOf(stroke, pressure) {
      const base = Number(stroke.size) || 4
      if (stroke.tool === 'marker') return base * 2.4
      if (stroke.tool === 'pencil') return base * 0.7
      if (stroke.tool === 'eraser') return base * ERASER_WIDTH_FACTOR
      return base
    }

    /** 宿主 size 上限：新版 300、旧宿主 60（没拿到接口字段时按旧值兜底）。 */
    function eraserSizeLimitOf(sizeMax) {
      const parsed = Number(sizeMax)
      if (!Number.isFinite(parsed) || parsed <= 0) return ERASER_SIZE_MAX_FALLBACK
      return Math.min(ERASER_SIZE_MAX_LATEST, Math.max(ERASER_SIZE_MAX_FALLBACK, parsed))
    }

    /** 当前宿主能力下允许的最大橡皮直径（世界 px）：size 上限 × 2.6，且不超过硬上限 400。 */
    function eraserDiameterLimit(sizeMax) {
      return Math.min(ERASER_DIAMETER_MAX, Math.max(ERASER_DIAMETER_MIN, Math.floor(eraserSizeLimitOf(sizeMax) * ERASER_WIDTH_FACTOR)))
    }

    /** 橡皮直径（世界 px）→ 存储用 size（按宿主上限夹紧，沿用旧渲染公式 size×2.6）。 */
    function eraserStrokeSize(diameter, sizeMax) {
      const parsed = Number(diameter)
      const clamped = Math.min(
        ERASER_DIAMETER_MAX,
        Math.max(ERASER_DIAMETER_MIN, Number.isFinite(parsed) ? parsed : ERASER_DIAMETER_DEFAULT),
      )
      const limit = eraserSizeLimitOf(sizeMax)
      return Math.round(Math.min(limit, Math.max(1, clamped / ERASER_WIDTH_FACTOR)) * 10) / 10
    }

    /** 单指拖动：起始相机 + 屏幕像素位移 → 新相机（画布跟手，方向与滚动相反）。 */
    function panCamera(startCamera, dxScreen, dyScreen) {
      const scale = Number(startCamera?.scale) > 0 ? startCamera.scale : 1
      return {
        scale,
        x: startCamera.x - dxScreen / scale,
        y: startCamera.y - dyScreen / scale,
      }
    }

    /** 双指缩放/平移：起始双指中点的世界坐标始终落在当前双指中点下方。 */
    function pinchCamera(gesture, distance, mid) {
      const startDistance = Math.max(1, Number(gesture.startDistance) || 1)
      const baseScale = Math.max(1e-6, Number(gesture.camera?.scale) || 1)
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, baseScale * (Math.max(1, distance) / startDistance)))
      const worldX = gesture.camera.x + gesture.startMid.x / baseScale
      const worldY = gesture.camera.y + gesture.startMid.y / baseScale
      return { scale, x: worldX - mid.x / scale, y: worldY - mid.y / scale }
    }

    function strokeAlphaOf(stroke) {
      if (stroke.tool === 'marker') return 0.22
      if (stroke.tool === 'pencil') return 0.55
      return 0.96
    }

    /** 在已经应用世界→屏幕变换的 ctx 上画一笔；橡皮用 destination-out 做像素级擦除。 */
    function paintStroke(ctx, stroke) {
      const points = Array.isArray(stroke.points) ? stroke.points : []
      if (points.length === 0) return
      const eraser = stroke.tool === 'eraser'
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (eraser) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.globalAlpha = 1
        ctx.strokeStyle = 'rgba(0,0,0,1)'
        ctx.fillStyle = 'rgba(0,0,0,1)'
      } else {
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = strokeAlphaOf(stroke)
        ctx.strokeStyle = stroke.color
        ctx.fillStyle = stroke.color
      }
      // 单击产生的「点」：两个相同坐标也要画出一个圆点（擦除同理）
      const firstPoint = points[0]
      const isDot = points.every((point) => Math.abs(point[0] - firstPoint[0]) < 0.01 && Math.abs(point[1] - firstPoint[1]) < 0.01)
      if (isDot) {
        ctx.beginPath()
        ctx.arc(firstPoint[0], firstPoint[1], Math.max(0.8, strokeWidthOf(stroke) / 2), 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
        return
      }
      if (stroke.tool === 'brush' && !eraser) {
        for (let index = 1; index < points.length; index += 1) {
          const previous = points[index - 1]
          const current = points[index]
          const pressure = Math.max(0.15, Math.min(1, Number(current[2]) || 0.5))
          const edge = Math.min(index, points.length - index) / Math.max(1, points.length * 0.18)
          const taper = Math.max(0.25, Math.min(1, edge))
          ctx.lineWidth = strokeWidthOf(stroke, pressure) * (0.35 + pressure * 0.85) * taper
          ctx.beginPath()
          ctx.moveTo(previous[0], previous[1])
          ctx.lineTo(current[0], current[1])
          ctx.stroke()
        }
        ctx.restore()
        return
      }
      ctx.lineWidth = strokeWidthOf(stroke)
      ctx.beginPath()
      if (points.length === 1) {
        const only = points[0]
        ctx.arc(only[0], only[1], ctx.lineWidth / 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
        return
      }
      const first = points[0]
      ctx.moveTo(first[0], first[1])
      for (let index = 1; index < points.length - 1; index += 1) {
        const current = points[index]
        const next = points[index + 1]
        ctx.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2)
      }
      const last = points[points.length - 1]
      ctx.lineTo(last[0], last[1])
      ctx.stroke()
      if (stroke.tool === 'pencil' && !eraser) {
        ctx.globalAlpha = strokeAlphaOf(stroke) * 0.45
        ctx.lineWidth = Math.max(0.7, ctx.lineWidth * 0.8)
        ctx.translate(0.6, 0.4)
        ctx.stroke()
      }
      ctx.restore()
    }

    /** 画一段正在输入的笔画（世界坐标，带相机变换）。 */
    function paintLive(ctx, stroke) {
      paintStroke(ctx, stroke)
    }

    /** 相机变换：camera.x / camera.y 是视口左上角对应的世界坐标，scale 是缩放比。 */
    function applyCamera(ctx, camera, dpr) {
      const scale = camera.scale * dpr
      ctx.setTransform(scale, 0, 0, scale, -camera.x * scale, -camera.y * scale)
    }

    /** 画背景网格（屏幕坐标），随相机缩放自动调整疏密。 */
    function renderGrid(ctx, width, height, camera, dpr, background) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      if (background === 'blank') return
      let step = GRID_STEP
      while (step * camera.scale < 18) step *= 2
      while (step * camera.scale > 90) step /= 2
      const screenStep = step * camera.scale
      const offsetX = ((-camera.x % step) + step) % step
      const offsetY = ((-camera.y % step) + step) % step
      ctx.save()
      ctx.strokeStyle = '#E8EEF7'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = offsetX * camera.scale; x < width; x += screenStep) {
        const lineX = Math.round(x) + 0.5
        ctx.moveTo(lineX, 0)
        ctx.lineTo(lineX, height)
      }
      for (let y = offsetY * camera.scale; y < height; y += screenStep) {
        const lineY = Math.round(y) + 0.5
        ctx.moveTo(0, lineY)
        ctx.lineTo(width, lineY)
      }
      ctx.stroke()
      ctx.restore()
    }

    /** 把相机适配到内容包围盒（留 padding）。 */
    function fitCamera(bounds, width, height, padding = 80) {
      const box = bounds ?? DEFAULT_BOUNDS
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(
        Math.max(1, width - padding * 2) / Math.max(1, box.w),
        Math.max(1, height - padding * 2) / Math.max(1, box.h),
        2,
      )))
      return {
        scale,
        x: box.x + box.w / 2 - width / (2 * scale),
        y: box.y + box.h / 2 - height / (2 * scale),
      }
    }

    /**
     * 渲染一张白板位图（缩略图/导出）：内容先画在透明画布上（橡皮才能只擦内容），
     * 再叠加白色背景与网格。
     */
    function renderBoardImage(board, options = {}) {
      if (typeof document === 'undefined') return null
      const width = Math.max(1, Math.round(options.width ?? THUMB_WIDTH))
      const height = Math.max(1, Math.round(options.height ?? THUMB_HEIGHT))
      const padding = Number.isFinite(options.padding) ? options.padding : 16
      const showGrid = options.grid !== false
      const bounds = contentBounds(board?.strokes) ?? DEFAULT_BOUNDS
      const scale = Math.min((width - padding * 2) / Math.max(1, bounds.w), (height - padding * 2) / Math.max(1, bounds.h))
      const offsetX = (width - bounds.w * scale) / 2 - bounds.x * scale
      const offsetY = (height - bounds.h * scale) / 2 - bounds.y * scale

      const content = document.createElement('canvas')
      content.width = width
      content.height = height
      const contentCtx = content.getContext('2d')
      contentCtx.setTransform(scale, 0, 0, scale, offsetX, offsetY)
      for (const stroke of Array.isArray(board?.strokes) ? board.strokes : []) paintStroke(contentCtx, stroke)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      if (showGrid && board?.background !== 'blank') {
        let step = GRID_STEP * scale
        while (step < 18) step *= 2
        while (step > 90) step /= 2
        const startX = ((offsetX % step) + step) % step
        const startY = ((offsetY % step) + step) % step
        ctx.strokeStyle = '#E8EEF7'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let x = startX; x < width; x += step) {
          const lineX = Math.round(x) + 0.5
          ctx.moveTo(lineX, 0)
          ctx.lineTo(lineX, height)
        }
        for (let y = startY; y < height; y += step) {
          const lineY = Math.round(y) + 0.5
          ctx.moveTo(0, lineY)
          ctx.lineTo(width, lineY)
        }
        ctx.stroke()
      }
      ctx.drawImage(content, 0, 0)
      return canvas
    }

    function renderThumbnail(board) {
      const canvas = renderBoardImage(board, { width: THUMB_WIDTH, height: THUMB_HEIGHT, padding: 16, grid: true })
      if (canvas === null) return ''
      try {
        return canvas.toDataURL('image/png', 0.7)
      } catch {
        return ''
      }
    }

    /* ---------------- 图标 ---------------- */

    function Glyph() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M4 20l4.2-1 10.4-10.4a2.2 2.2 0 0 0-3.2-3.2L5 15.8 4 20z', stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round' }),
        h('path', { d: 'M13.5 6.5l4 4', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
      )
    }

    function Icon(props) {
      const name = props.name
      const size = props.size ?? 14
      const paths = {
        plus: 'M12 5v14M5 12h14',
        trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
        undo: 'M9 7L4 12l5 5M4 12h9a5 5 0 0 1 0 10',
        redo: 'M15 7l5 5-5 5M20 12h-9a5 5 0 0 0 0 10',
        download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
        back: 'M15 5l-7 7 7 7',
        grid: 'M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16',
        check: 'M5 12l5 5L20 7',
      }
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: paths[name] ?? paths.check, stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** 工具按钮上的小图标（铅笔/钢笔/毛笔/马克笔/橡皮/抓手）。 */
    function ToolIcon(props) {
      const defs = {
        pencil: [
          ['M4.2 19.8l3.6-.9L19.2 7.5a2 2 0 0 0-2.8-2.8L5.1 16.1 4.2 19.8z', 'stroke'],
          ['M14.8 6.6l2.8 2.8', 'stroke'],
        ],
        pen: [
          ['M12 3.4l4.4 4.5-4.4 12.7-4.4-12.7L12 3.4z', 'stroke'],
          ['M12 8.8v6.6', 'stroke'],
        ],
        brush: [
          ['M9.2 13.8l9-9.4a2.2 2.2 0 0 1 3.1 3.1l-9.4 9', 'stroke'],
          ['M8 15l2.4 2.4', 'stroke'],
          ['M9.2 13.8c-2.9-.3-4.7 1.5-5.2 5.4 3.9-.6 5.6-2.3 5.2-5.4z', 'fill'],
        ],
        marker: [
          ['M13.8 4.4l5.8 5.8-6.4 6.4H8v-5.2l5.8-7z', 'stroke'],
          ['M4.6 20.2h14.8', 'stroke'],
        ],
        eraser: [
          ['M9.8 19.8H6.4l-2.6-2.6 7.6-7.6 6.4 6.4-4.2 3.8H9.8z', 'stroke'],
          ['M11.4 9.6l6.4 6.4', 'stroke'],
        ],
        hand: [
          ['M8.2 12.4V7.2a1.4 1.4 0 0 1 2.8 0V11', 'stroke'],
          ['M11 11V5.8a1.4 1.4 0 0 1 2.8 0V11', 'stroke'],
          ['M13.8 11.2V6.6a1.4 1.4 0 0 1 2.8 0v8', 'stroke'],
          ['M8.2 12.4V10a1.4 1.4 0 0 0-2.8 0v3.4c0 3.8 2.4 6.6 6.4 6.6h1c2.9 0 5-2.1 5-5v-3.2', 'stroke'],
        ],
      }
      const list = defs[props.name] ?? defs.pen
      return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        ...list.map(([d, mode], index) => h('path', {
          key: index,
          d,
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          fill: mode === 'fill' ? 'currentColor' : 'none',
        })),
      )
    }

    /* ---------------- 橡皮大小（可拖动滑块） ---------------- */

    /**
     * 橡皮擦大小拖动滑块：按住滑块左右拖动即可连续调整直径（世界坐标 px），
     * 左侧圆点与画笔光标同步预览实际大小。
     */
    function EraserSizeControl(props) {
      const trackRef = useRef(null)
      const draggingRef = useRef(false)
      const [dragging, setDragging] = useState(false)
      const maxDiameter = Math.max(ERASER_DIAMETER_MIN + 1, Math.min(ERASER_DIAMETER_MAX, Number(props.max) || ERASER_DIAMETER_MAX))
      const value = Math.max(ERASER_DIAMETER_MIN, Math.min(maxDiameter, Number(props.value) || ERASER_DIAMETER_DEFAULT))
      const ratio = (value - ERASER_DIAMETER_MIN) / (maxDiameter - ERASER_DIAMETER_MIN)

      const applyClientX = (clientX) => {
        const track = trackRef.current
        if (track === null || typeof track.getBoundingClientRect !== 'function') return
        const rect = track.getBoundingClientRect()
        const nextRatio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
        const nextValue = Math.round(ERASER_DIAMETER_MIN + nextRatio * (maxDiameter - ERASER_DIAMETER_MIN))
        if (nextValue !== value && typeof props.onChange === 'function') props.onChange(nextValue)
      }

      const stopDrag = (event) => {
        if (draggingRef.current !== true) return
        draggingRef.current = false
        setDragging(false)
        try { trackRef.current?.releasePointerCapture?.(event.pointerId) } catch { /* ignore */ }
      }

      return h('span', { className: 'wb-eraser-box', title: '拖动滑块调整橡皮擦大小（' + ERASER_DIAMETER_MIN + '–' + maxDiameter + '，也可用 [ / ] 键微调）' },
        h('span', { className: 'wb-eraser-cap' }, '橡皮大小'),
        h('span', { className: 'wb-eraser-dot' },
          h('i', { style: { width: Math.round(4 + ratio * 16), height: Math.round(4 + ratio * 16) } }),
        ),
        h('span', {
          ref: trackRef,
          className: 'wb-slider' + (dragging ? ' wb-slider--on' : ''),
          role: 'slider',
          tabIndex: 0,
          'aria-label': '橡皮擦大小',
          'aria-valuemin': ERASER_DIAMETER_MIN,
          'aria-valuemax': maxDiameter,
          'aria-valuenow': value,
          onPointerDown: (event) => {
            if (event.button !== undefined && event.button !== 0 && event.pointerType === 'mouse') return
            event.preventDefault()
            event.stopPropagation()
            draggingRef.current = true
            setDragging(true)
            try { trackRef.current?.setPointerCapture?.(event.pointerId) } catch { /* ignore */ }
            applyClientX(event.clientX)
          },
          onPointerMove: (event) => {
            if (draggingRef.current !== true) return
            event.preventDefault()
            applyClientX(event.clientX)
          },
          onPointerUp: stopDrag,
          onPointerCancel: stopDrag,
          onPointerLeave: (event) => { if (draggingRef.current === true && event.buttons === 0) stopDrag(event) },
          onKeyDown: (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const step = event.key === 'ArrowRight' ? 4 : -4
            if (typeof props.onChange === 'function') props.onChange(value + step)
          },
        },
        h('span', { className: 'wb-slider-rail' }),
        h('span', { className: 'wb-slider-fill', style: { width: (ratio * 100) + '%' } }),
        h('span', { className: 'wb-slider-thumb', style: { left: (ratio * 100) + '%' } }),
        ),
        h('span', { className: 'wb-eraser-num' }, String(Math.round(value))),
      )
    }

    /* ---------------- 列表 ---------------- */

    function BoardCard(props) {
      const board = props.board
      return h('button', {
        type: 'button',
        className: 'wb-card',
        title: '点击继续编辑',
        onClick: () => props.onOpen(board.id),
      },
      h('span', { className: 'wb-card-thumb' },
        board.thumbnail !== ''
          ? h('img', { src: board.thumbnail, alt: '', draggable: false })
          : h('span', { className: 'wb-card-thumb-empty' }, '✎'),
      ),
      h('span', { className: 'wb-card-title' }, board.title || '未命名白板'),
      h('span', { className: 'wb-card-meta' },
        h('span', null, formatStamp(board.updatedAt)),
        h('span', null, '·'),
        h('span', null, countStrokes(board.strokes) > 0 ? countStrokes(board.strokes) + ' 笔' : (Number(board.strokeCount) || 0) + ' 笔'),
      ),
      h('span', { className: 'wb-card-actions' },
        h('span', {
          role: 'button',
          tabIndex: 0,
          className: 'wb-btn wb-btn--sm wb-btn--danger',
          onClick: (event) => { event.stopPropagation(); props.onDelete(board) },
        }, '删除'),
      ))
    }

    function ListView(props) {
      const boards = props.boards
      const update = props.updateResult
      let updateBar = null
      if (update !== null && update !== undefined && (update.hasUpdate === true || props.updateTouched === true)) {
        if (update.hasUpdate === true) {
          updateBar = h('div', { className: 'wb-update wb-update--new' },
            h('span', null, '发现新版本 v' + String(update.latest ?? '') + (props.appVersion !== '' ? '（当前 v' + props.appVersion + '）' : '')),
            h('a', { className: 'wb-link', href: String(update.url ?? ''), target: '_blank', rel: 'noreferrer' }, '下载 / 查看说明'),
            h('span', { className: 'wb-update-hint' }, '下载新包覆盖 node_modules\\dsh-whiteboard 后重启 Desktop，白板数据不会丢。'),
          )
        } else if (update.ok === true) {
          const current = String(update.current ?? props.appVersion)
          updateBar = h('div', { className: 'wb-update' }, '已是最新版本' + (current !== '' ? '（v' + current + '）' : ''))
        } else {
          updateBar = h('div', { className: 'wb-update wb-update--error' }, String(update.error ?? '检查更新失败'))
        }
      }
      return h('div', { className: 'wb-body' },
        h('div', { className: 'wb-list' },
          h('div', { className: 'wb-list-head' },
            h('span', { className: 'wb-list-title' }, '我的白板'),
            h('span', { className: 'wb-list-count' }, boards.length + ' 个'),
            h('span', { className: 'wb-spacer' }),
            props.appVersion !== '' ? h('span', { className: 'wb-version' }, 'v' + props.appVersion) : null,
            h('button', {
              type: 'button',
              className: 'wb-btn wb-btn--sm',
              title: '检查 GitHub Releases 上有没有新版本（不下载、不自动安装）',
              onClick: props.onCheckUpdate,
              disabled: props.updateState === 'checking',
            }, props.updateState === 'checking' ? '检查中…' : '检查更新'),
            h('button', { type: 'button', className: 'wb-btn wb-btn--primary', onClick: props.onCreate }, h(Icon, { name: 'plus', size: 13 }), '新建白板'),
          ),
          updateBar,
          props.error !== null ? h('div', { className: 'wb-error' }, props.error) : null,
          boards.length === 0
            ? h('div', { className: 'wb-empty' },
              h('span', { className: 'wb-empty-mark' }, '✎'),
              h('span', null, '还没有白板，点「新建白板」开始手写。'),
              h('button', { type: 'button', className: 'wb-btn wb-btn--primary', onClick: props.onCreate }, '新建白板'),
            )
            : h('div', { className: 'wb-grid' }, ...boards.map((board) => h(BoardCard, {
              key: board.id,
              board,
              onOpen: props.onOpen,
              onDelete: props.onDelete,
            }))),
        ),
      )
    }

    /* ---------------- 画布编辑器 ---------------- */

    function CanvasBoard(props) {
      const wrapRef = useRef(null)
      const bgRef = useRef(null)
      const contentRef = useRef(null)
      const liveRef = useRef(null)
      const touchesRef = useRef(new Map())
      /** 笔书写期间落下的手指/手掌：先记下来，抬笔后再决定是否接管为平移（避免"必须抬起再按"）。 */
      const ignoredTouchesRef = useRef(new Map())
      const gestureRef = useRef(null)
      const suppressTouchDrawRef = useRef(false)
      /** 单指拖动平移的状态（仅手写笔模式下手指默认做平移，不画线）。 */
      const singlePanRef = useRef(null)
      /** 橡皮光标预览圆。 */
      const eraserCursorRef = useRef(null)
      const lastPointerRef = useRef(null)
      const sizeRef = useRef({ w: 0, h: 0 })
      const cameraRef = useRef(props.camera)
      cameraRef.current = props.camera
      const [viewport, setViewport] = useState({ w: 0, h: 0 })
      const [panning, setPanning] = useState(false)
      const spaceRef = useRef(false)
      const apiRef = useRef(null)
      const strokes = props.strokes
      const strokesRef = useRef(strokes)
      strokesRef.current = strokes
      const camera = props.camera
      const tool = props.tool
      const color = props.color
      const size = props.size
      const background = props.background
      const penOnly = props.penOnly !== false
      const eraserDiameter = Number(props.eraserDiameter) || ERASER_DIAMETER_DEFAULT
      const eraserSizeMax = props.eraserSizeMax

      const dprOf = () => (typeof window !== 'undefined' && Number(window.devicePixelRatio) > 0 ? window.devicePixelRatio : 1)

      /** 橡皮光标：跟随指针画一个与真实擦除直径一致的圆圈（屏幕 px = 世界直径 × 缩放）。 */
      const updateEraserCursor = (event) => {
        const node = eraserCursorRef.current
        if (node === null) return
        if (event !== null && event !== undefined) lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY }
        const last = lastPointerRef.current
        const live = liveRef.current
        const erasing = tool === 'eraser' || (live !== null && live.tool === 'eraser')
        const canvas = contentRef.current
        if (erasing !== true || last === null || canvas === null) {
          node.style.display = 'none'
          return
        }
        const rect = canvas.getBoundingClientRect()
        const diameter = Math.max(4, eraserDiameter * (Number(cameraRef.current.scale) || 1))
        node.style.display = 'block'
        node.style.width = diameter + 'px'
        node.style.height = diameter + 'px'
        node.style.transform = 'translate(' + Math.round(last.clientX - rect.left - diameter / 2) + 'px,' + Math.round(last.clientY - rect.top - diameter / 2) + 'px)'
      }

      const hideEraserCursor = () => {
        const node = eraserCursorRef.current
        if (node !== null) node.style.display = 'none'
      }

      /* 切换工具 / 改橡皮大小 / 缩放后，光标圆需要立刻跟着变 */
      useEffect(() => {
        updateEraserCursor(null)
      }, [tool, eraserDiameter, camera.scale])

      /* 尺寸变化：画布像素 = CSS 尺寸 × dpr */
      useEffect(() => {
        const wrap = wrapRef.current
        if (wrap === null || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver((entries) => {
          const rect = entries[0]?.contentRect
          if (rect === undefined) return
          const w = Math.max(200, Math.round(rect.width))
          const h = Math.max(200, Math.round(rect.height))
          sizeRef.current = { w, h }
          setViewport((previous) => (previous.w === w && previous.h === h ? previous : { w, h }))
        })
        observer.observe(wrap)
        return () => observer.disconnect()
      }, [])

      /* 背景网格 */
      useEffect(() => {
        const canvas = bgRef.current
        if (canvas === null || viewport.w <= 0) return
        const dpr = dprOf()
        canvas.width = Math.round(viewport.w * dpr)
        canvas.height = Math.round(viewport.h * dpr)
        renderGrid(canvas.getContext('2d'), viewport.w, viewport.h, camera, dpr, background)
      }, [viewport.w, viewport.h, camera.x, camera.y, camera.scale, background])

      /* 内容层（透明，橡皮用 destination-out 只擦内容） */
      useEffect(() => {
        const canvas = contentRef.current
        if (canvas === null || viewport.w <= 0) return
        const dpr = dprOf()
        canvas.width = Math.round(viewport.w * dpr)
        canvas.height = Math.round(viewport.h * dpr)
        const ctx = canvas.getContext('2d')
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        applyCamera(ctx, camera, dpr)
        for (const stroke of strokes) paintStroke(ctx, stroke)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      }, [viewport.w, viewport.h, camera.x, camera.y, camera.scale, strokes])

      /* 首次打开：把视图适配到已有内容 */
      useEffect(() => {
        if (props.pendingFit !== true || viewport.w <= 0 || viewport.h <= 0) return
        const next = fitCamera(contentBounds(strokes), viewport.w, viewport.h)
        props.setCamera(next)
        if (typeof props.onFitDone === 'function') props.onFitDone()
      }, [props.pendingFit, viewport.w, viewport.h])

      /* 对外暴露缩放/适配操作，供工具栏按钮调用 */
      useEffect(() => {
        if (typeof props.onApi !== 'function') return
        props.onApi({
          zoomBy: (factor) => {
            const current = cameraRef.current
            const { w, h } = sizeRef.current
            const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor))
            const worldX = current.x + w / (2 * current.scale)
            const worldY = current.y + h / (2 * current.scale)
            props.setCamera({
              scale: nextScale,
              x: worldX - w / (2 * nextScale),
              y: worldY - h / (2 * nextScale),
            })
          },
          fit: () => {
            const current = cameraRef.current
            const { w, h } = sizeRef.current
            const next = fitCamera(contentBounds(strokes), w, h)
            props.setCamera(next)
            void current
          },
        })
      }, [props.onApi, strokes])

      /* 空格键临时抓手 */
      useEffect(() => {
        const isTyping = (target) => target !== null && typeof target === 'object'
          && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true)
        const down = (event) => {
          if (event.code === 'Space' && !isTyping(event.target)) {
            event.preventDefault()
            spaceRef.current = true
          }
        }
        const up = (event) => {
          if (event.code === 'Space') spaceRef.current = false
        }
        window.addEventListener('keydown', down)
        window.addEventListener('keyup', up)
        return () => {
          window.removeEventListener('keydown', down)
          window.removeEventListener('keyup', up)
        }
      }, [])

      /* 滚轮缩放（以光标为中心） */
      useEffect(() => {
        const canvas = contentRef.current
        if (canvas === null) return undefined
        const onWheel = (event) => {
          event.preventDefault()
          const current = cameraRef.current
          const rect = canvas.getBoundingClientRect()
          const screenX = event.clientX - rect.left
          const screenY = event.clientY - rect.top
          const worldX = current.x + screenX / current.scale
          const worldY = current.y + screenY / current.scale
          const factor = Math.exp(-event.deltaY * 0.0015)
          const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor))
          props.setCamera({
            scale: nextScale,
            x: worldX - screenX / nextScale,
            y: worldY - screenY / nextScale,
          })
        }
        canvas.addEventListener('wheel', onWheel, { passive: false })
        return () => canvas.removeEventListener('wheel', onWheel)
      }, [props.setCamera])

      const pointFromEvent = (event) => {
        const rect = contentRef.current.getBoundingClientRect()
        const current = cameraRef.current
        const x = current.x + (event.clientX - rect.left) / current.scale
        const y = current.y + (event.clientY - rect.top) / current.scale
        const pressure = event.pointerType === 'pen' ? Math.max(0.08, Math.min(1, event.pressure || 0.4)) : 0.5
        return [x, y, Math.round(pressure * 100) / 100]
      }

      const penEraserActive = (event) => {
        if (event.pointerType !== 'pen') return false
        const buttons = Number(event.buttons) || 0
        return event.button === 5 || event.button === 2 || (buttons & 32) === 32 || (buttons & 2) === 2
      }

      const touchPoint = (event) => ({ x: event.clientX, y: event.clientY })

      const redrawContent = () => {
        const canvas = contentRef.current
        if (canvas === null) return
        const dpr = dprOf()
        const ctx = canvas.getContext('2d')
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        applyCamera(ctx, cameraRef.current, dpr)
        for (const stroke of strokesRef.current) paintStroke(ctx, stroke)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      }

      /** 单指拖动：记录起始位置与起始相机，move 时按位移平移画布。 */
      const startSinglePan = (event) => {
        singlePanRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          camera: { ...cameraRef.current },
        }
        try { contentRef.current?.setPointerCapture?.(event.pointerId) } catch { /* ignore */ }
      }

      /** 只取消「手指正在画的笔迹」，笔/鼠标的笔迹不受影响。 */
      const cancelLiveTouch = () => {
        const live = liveRef.current
        if (live === null || live.isTouch !== true) return
        liveRef.current = null
        redrawContent()
      }

      const beginTouchGesture = () => {
        if (gestureRef.current !== null) return
        if (touchesRef.current.size < 2) return
        // 笔正在书写/擦除时，手指手势不打断笔迹（笔优先）
        if (liveRef.current !== null && liveRef.current.isTouch !== true) return
        cancelLiveTouch()
        singlePanRef.current = null
        const ids = [...touchesRef.current.keys()].slice(0, 2)
        const first = touchesRef.current.get(ids[0])
        const second = touchesRef.current.get(ids[1])
        if (first === undefined || second === undefined) return
        gestureRef.current = {
          ids,
          startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          startMid: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
          camera: { ...cameraRef.current },
        }
        suppressTouchDrawRef.current = true
        setPanning(false)
      }

      const applyTouchGesture = () => {
        const gesture = gestureRef.current
        if (gesture === null) return
        const first = touchesRef.current.get(gesture.ids[0])
        const second = touchesRef.current.get(gesture.ids[1])
        if (first === undefined || second === undefined) return
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
        const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
        // 起始双指中点的世界坐标钉在当前双指中点下 → 以双指中心放大缩小，同时跟手平移
        props.setCamera(pinchCamera(gesture, distance, mid))
      }

      /** 笔书写期间落下的手指/手掌只登记位置与接触面积，不参与手势。 */
      const rememberIgnoredTouch = (event) => {
        const width = Number(event.width) || 0
        const height = Number(event.height) || 0
        ignoredTouchesRef.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
          area: Math.max(1, width) * Math.max(1, height),
          known: width > 0 && height > 0,
          at: Date.now(),
        })
        // 抓住这只手指的事件，避免它在画布外移动时丢失 pointermove（后续抬笔接管需要它的位置）
        try { contentRef.current?.setPointerCapture?.(event.pointerId) } catch { /* ignore */ }
      }

      /**
       * 抬笔后处理仍按在屏幕上的手指：
       * - 笔写前就在按、被笔中断平移的手指：立即续上平移；
       * - 笔写期间落下的手指：先"上膛"（记录当前位置为基准），等它真的推动超过 8px 再接管，
       *   这样休息的手掌不会因为轻微挪动就误触发平移。
       */
      const resumeTouchesAfterPen = () => {
        if (liveRef.current !== null) return
        if (gestureRef.current !== null) return
        const tracked = [...touchesRef.current.entries()]
        if (tracked.length > 0 && singlePanRef.current === null) {
          suppressTouchDrawRef.current = true
          if (tracked.length >= 2) {
            beginTouchGesture()
          } else {
            const [pointerId, value] = tracked[0]
            singlePanRef.current = {
              pointerId,
              startX: value.x,
              startY: value.y,
              camera: { ...cameraRef.current },
            }
            try { contentRef.current?.setPointerCapture?.(pointerId) } catch { /* ignore */ }
          }
        }
        const now = Date.now()
        for (const [pointerId, value] of [...ignoredTouchesRef.current.entries()]) {
          if (now - value.at > 2000) {
            ignoredTouchesRef.current.delete(pointerId)
            continue
          }
          value.armedAt = now
          value.baseX = value.x
          value.baseY = value.y
        }
      }

      const onPointerDown = (event) => {
        if (event.pointerType === 'touch') {
          hideEraserCursor()
          // 笔正在书写/擦除：落下的手指/手掌先登记，不打断当前笔画；抬笔后再决定是否接管
          if (liveRef.current !== null && liveRef.current.isTouch !== true) {
            rememberIgnoredTouch(event)
            event.preventDefault()
            return
          }
          ignoredTouchesRef.current.delete(event.pointerId)
          touchesRef.current.set(event.pointerId, touchPoint(event))
          if (touchesRef.current.size >= 2) {
            beginTouchGesture()
            event.preventDefault()
            return
          }
          // 仅手写笔模式下（或选中抓手工具），单指拖动 = 平移画布
          const fingerDraw = !penOnly && tool !== 'hand' && spaceRef.current !== true
          if (!fingerDraw) {
            cancelLiveTouch()
            startSinglePan(event)
            event.preventDefault()
            return
          }
          // 允许手指画线：单指继续走正常绘制流程
        } else {
          updateEraserCursor(event)
        }
        if (gestureRef.current !== null) return
        if (event.button !== undefined && event.button !== 0 && event.pointerType === 'mouse' && event.button !== 1) return
        const current = liveRef.current
        if (current !== null && current.pointerId !== undefined && current.pointerId !== event.pointerId) return
        // 笔/鼠标开始书写时结束正在进行的手指平移，避免两套手势互相打架
        if (event.pointerType !== 'touch') singlePanRef.current = null
        const wantsPan = event.button === 1 || tool === 'hand' || spaceRef.current === true
        if (wantsPan) {
          event.preventDefault()
          setPanning(true)
          liveRef.current = {
            pan: true,
            pointerId: event.pointerId,
            isTouch: event.pointerType === 'touch',
            startX: event.clientX,
            startY: event.clientY,
            camera: { ...cameraRef.current },
          }
          contentRef.current.setPointerCapture?.(event.pointerId)
          return
        }
        event.preventDefault()
        contentRef.current.setPointerCapture?.(event.pointerId)
        const point = pointFromEvent(event)
        const activeTool = penEraserActive(event) ? 'eraser' : tool
        liveRef.current = {
          pointerId: event.pointerId,
          isTouch: event.pointerType === 'touch',
          tool: activeTool,
          color,
          // 橡皮用独立的「直径」设置（存回 size 时按旧公式除以 2.6），笔宽仍由粗细档位决定
          size: activeTool === 'eraser' ? eraserStrokeSize(eraserDiameter, eraserSizeMax) : size,
          points: [point],
        }
        drawLiveSegment(liveRef.current, point, point)
      }

      const drawLiveSegment = (live, previous, current) => {
        const canvas = contentRef.current
        if (canvas === null) return
        const dpr = dprOf()
        const ctx = canvas.getContext('2d')
        applyCamera(ctx, cameraRef.current, dpr)
        paintStroke(ctx, { tool: live.tool, color: live.color, size: live.size, points: [previous, current] })
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      }

      const onPointerMove = (event) => {
        if (event.pointerType !== 'touch') updateEraserCursor(event)
        if (event.pointerType === 'touch') {
          if (!touchesRef.current.has(event.pointerId)) {
            const pending = ignoredTouchesRef.current.get(event.pointerId)
            // 既不是已跟踪触点、也不是笔写时登记的触点 → 与手势无关
            if (pending === undefined) return
            pending.x = event.clientX
            pending.y = event.clientY
            // 笔还在写：只更新位置，不抢笔
            if (liveRef.current !== null && liveRef.current.isTouch !== true) return
            if (pending.armedAt === undefined) {
              pending.armedAt = Date.now()
              pending.baseX = event.clientX
              pending.baseY = event.clientY
              return
            }
            // 只有「真的推动了」才接管，避免把休息的手掌轻微挪动误判成平移
            if (Math.hypot(event.clientX - pending.baseX, event.clientY - pending.baseY) < 10) return
            // 接触面积明显偏大 = 手掌/袖口，交给系统拒绝，不接管
            if (pending.known === true && pending.area > 1600) return
            ignoredTouchesRef.current.delete(event.pointerId)
            touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
            suppressTouchDrawRef.current = true
            if (singlePanRef.current === null && gestureRef.current === null) {
              singlePanRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                camera: { ...cameraRef.current },
              }
              try { contentRef.current?.setPointerCapture?.(event.pointerId) } catch { /* ignore */ }
            } else if (gestureRef.current === null) {
              beginTouchGesture()
            }
            return
          }
          touchesRef.current.set(event.pointerId, touchPoint(event))
          // 笔正在写时，已按下的手指暂停参与手势（笔优先）
          if (liveRef.current !== null && liveRef.current.isTouch !== true) return
          if (gestureRef.current !== null) {
            event.preventDefault()
            applyTouchGesture()
            return
          }
          const pan = singlePanRef.current
          if (pan !== null && pan.pointerId === event.pointerId) {
            event.preventDefault()
            props.setCamera(panCamera(pan.camera, event.clientX - pan.startX, event.clientY - pan.startY))
            return
          }
          if (suppressTouchDrawRef.current || penOnly) return
        }
        const live = liveRef.current
        if (live === null) return
        if (live.pointerId !== undefined && event.pointerId !== live.pointerId) return
        event.preventDefault()
        if (live.pan === true) {
          const dx = (event.clientX - live.startX) / cameraRef.current.scale
          const dy = (event.clientY - live.startY) / cameraRef.current.scale
          props.setCamera({ scale: live.camera.scale, x: live.camera.x - dx, y: live.camera.y - dy })
          return
        }
        const point = pointFromEvent(event)
        const previous = live.points[live.points.length - 1]
        if (previous !== undefined && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.5) return
        live.points.push(point)
        drawLiveSegment(live, previous, point)
      }

      const finishPointer = (event) => {
        if (event?.pointerType === 'touch') {
          const tracked = touchesRef.current.has(event.pointerId)
          touchesRef.current.delete(event.pointerId)
          ignoredTouchesRef.current.delete(event.pointerId)
          const gesture = gestureRef.current
          if (gesture !== null && gesture.ids.includes(event.pointerId)) {
            gestureRef.current = null
            // 双指变单指：剩下的手指接着平移（从当前相机继续，不跳变），且不画线
            const remaining = [...touchesRef.current.entries()][0]
            if (remaining !== undefined && (liveRef.current === null || liveRef.current.isTouch !== true)) {
              singlePanRef.current = {
                pointerId: remaining[0],
                startX: remaining[1].x,
                startY: remaining[1].y,
                camera: { ...cameraRef.current },
              }
              suppressTouchDrawRef.current = true
              try { contentRef.current?.setPointerCapture?.(remaining[0]) } catch { /* ignore */ }
            } else {
              suppressTouchDrawRef.current = touchesRef.current.size > 0
            }
          }
          const pan = singlePanRef.current
          if (pan !== null && pan.pointerId === event.pointerId) singlePanRef.current = null
          if (touchesRef.current.size === 0) {
            suppressTouchDrawRef.current = false
            singlePanRef.current = null
            gestureRef.current = null
          }
          // 落笔时被忽略的手指（例如手掌）：只做清理，不影响笔迹
          if (!tracked && (liveRef.current === null || liveRef.current.pointerId !== event.pointerId)) return
        }
        const live = liveRef.current
        if (live === null) return
        if (event !== undefined && live.pointerId !== undefined && event.pointerId !== live.pointerId) return
        liveRef.current = null
        if (live.pan === true) {
          setPanning(false)
          if (live.isTouch !== true) resumeTouchesAfterPen()
          return
        }
        const points = live.points.length === 1 ? [live.points[0], live.points[0]] : live.points
        props.onStroke({ tool: live.tool, color: live.color, size: live.size, points })
        // 笔写完后：把仍按在屏幕上的手指接管为平移（Windows 笔/触控仲裁期间按下的手指也能立即续上）
        if (live.isTouch !== true) resumeTouchesAfterPen()
        // 笔上橡皮键松开后，若当前工具不是橡皮则隐藏光标圆
        if (event !== undefined && event.pointerType !== 'touch') updateEraserCursor(event)
      }

      const drawingCursor = tool === 'hand' || panning ? (panning ? ' wb-canvas--panning' : ' wb-canvas--hand') : (tool === 'eraser' ? ' wb-canvas--eraser' : '')

      return h('div', { className: 'wb-canvas-wrap' },
        h('div', { className: 'wb-canvas-viewport', ref: wrapRef },
          h('canvas', { ref: bgRef, className: 'wb-canvas wb-canvas--bg' }),
          h('canvas', {
            ref: contentRef,
            className: 'wb-canvas wb-canvas--content' + drawingCursor,
            onPointerDown,
            onPointerMove,
            onPointerUp: finishPointer,
            onPointerCancel: finishPointer,
            onContextMenu: (event) => event.preventDefault(),
            onPointerLeave: (event) => { hideEraserCursor(); if (liveRef.current !== null && event.buttons === 0) finishPointer(event) },
          }),
          h('div', { ref: eraserCursorRef, className: 'wb-eraser-cursor' }),
        ),
        h('div', { className: 'wb-tip' }, penOnly
          ? '单指拖动平移 · 双指缩放 · 滚轮缩放；手指不会画线，数位笔书写、按住笔上橡皮键或选橡皮工具擦除。抬笔后手指若暂时拖不动，是系统的「笔悬停防误触」，把笔移离屏幕一点即可。'
          : '双指缩放 · 滚轮缩放 · 抓手工具拖动平移；允许手指画线时单指即书写。橡皮大小可拖动右侧滑块调整。'),
      )
    }

    function EditorView(props) {
      const board = props.board
      /** 宿主支持的橡皮 size 上限（旧宿主没有该字段时按 60 兜底）→ 换算成直径上限。 */
      const eraserSizeMax = props.eraserSizeMax
      const eraserDiameterMax = eraserDiameterLimit(eraserSizeMax)
      const [title, setTitle] = useState(board.title)
      const [strokes, setStrokes] = useState(() => board.strokes ?? [])
      const [background, setBackground] = useState(board.background ?? 'grid')
      const [tool, setTool] = useState('pen')
      const [penOnly, setPenOnly] = useState(() => {
        try {
          const stored = window.localStorage.getItem('dsh-whiteboard:pen-only')
          return stored === null ? true : stored === '1'
        } catch {
          return true
        }
      })
      const [color, setColor] = useState(COLORS[0])
      const [size, setSize] = useState(WIDTHS[1])
      const [eraserDiameter, setEraserDiameter] = useState(() => {
        try {
          const stored = Number(window.localStorage.getItem(ERASER_DIAMETER_KEY))
          if (Number.isFinite(stored) && stored >= ERASER_DIAMETER_MIN && stored <= ERASER_DIAMETER_MAX) {
            return Math.round(Math.min(stored, eraserDiameterMax))
          }
        } catch { /* ignore */ }
        return Math.min(ERASER_DIAMETER_DEFAULT, eraserDiameterMax)
      })
      const [camera, setCamera] = useState(() => (board.view === undefined ? { x: 0, y: 0, scale: 1 } : board.view))
      const [pendingFit, setPendingFit] = useState(() => board.view === undefined)
      const [saveState, setSaveState] = useState('saved')
      const [error, setError] = useState(null)
      const canvasApiRef = useRef(null)
      const historyRef = useRef({ past: [], future: [] })
      const saveTimerRef = useRef(null)
      const strokesRef = useRef(strokes)
      strokesRef.current = strokes
      const titleRef = useRef(title)
      titleRef.current = title
      const backgroundRef = useRef(background)
      backgroundRef.current = background
      const cameraRef = useRef(camera)
      cameraRef.current = camera

      const pushHistory = () => {
        const history = historyRef.current
        history.past.push(strokesRef.current)
        if (history.past.length > MAX_HISTORY) history.past.shift()
        history.future = []
      }

      /** 橡皮大小（世界坐标直径，px）：夹紧到当前宿主能力允许的范围并记住上次选择。 */
      const changeEraserDiameter = (next) => {
        const parsed = Number(next)
        const clamped = Math.round(Math.max(
          ERASER_DIAMETER_MIN,
          Math.min(eraserDiameterMax, Number.isFinite(parsed) ? parsed : ERASER_DIAMETER_DEFAULT),
        ))
        setEraserDiameter(clamped)
        try { window.localStorage.setItem(ERASER_DIAMETER_KEY, String(clamped)) } catch { /* ignore */ }
      }

      const saveNow = useCallback(async (nextStrokes, nextTitle, nextBackground, nextView) => {
        setSaveState('saving')
        try {
          const thumbnail = renderThumbnail({ strokes: nextStrokes, background: nextBackground })
          await requestJson('/boards/' + encodeURIComponent(board.id), {
            method: 'PUT',
            body: {
              title: nextTitle,
              strokes: nextStrokes,
              background: nextBackground,
              view: nextView ?? cameraRef.current,
              thumbnail,
            },
          })
          setSaveState('saved')
          setError(null)
        } catch (caught) {
          setSaveState('error')
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }, [board.id])

      const scheduleSave = () => {
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
        setSaveState('dirty')
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null
          void saveNow(strokesRef.current, titleRef.current, backgroundRef.current, cameraRef.current)
        }, SAVE_DEBOUNCE_MS)
      }

      useEffect(() => () => {
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
      }, [])

      // 打开旧白板时补一次保存：修复旧版本「缩略图空白」的问题，同时刷新缩略图
      useEffect(() => {
        const timer = window.setTimeout(() => {
          void saveNow(strokesRef.current, titleRef.current, backgroundRef.current, cameraRef.current)
        }, 300)
        return () => window.clearTimeout(timer)
      }, [saveNow])

      const undo = () => {
        const history = historyRef.current
        if (history.past.length === 0) return
        const previous = history.past.pop()
        history.future.push(strokesRef.current)
        setStrokes(previous)
        scheduleSave()
      }
      const redo = () => {
        const history = historyRef.current
        if (history.future.length === 0) return
        const next = history.future.pop()
        history.past.push(strokesRef.current)
        setStrokes(next)
        scheduleSave()
      }

      useEffect(() => {
        const onKey = (event) => {
          if (event.ctrlKey || event.metaKey) {
            if (event.key.toLowerCase() === 'z') {
              event.preventDefault()
              if (event.shiftKey) redo(); else undo()
            } else if (event.key.toLowerCase() === 'y') {
              event.preventDefault()
              redo()
            }
            return
          }
          // 橡皮工具下用 [ / ] 微调橡皮大小（与拖动滑块等价）
          if (tool === 'eraser' && (event.key === '[' || event.key === ']')) {
            event.preventDefault()
            changeEraserDiameter(eraserDiameter + (event.key === ']' ? 6 : -6))
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      })

      const exportPng = () => {
        const bounds = contentBounds(strokes) ?? { x: 0, y: 0, w: 1600, h: 1000 }
        const padding = 120
        const width = Math.max(800, Math.min(2400, Math.round(bounds.w + padding * 2)))
        const height = Math.max(500, Math.min(2000, Math.round(bounds.h + padding * 2)))
        const canvas = renderBoardImage({ strokes, background }, { width, height, padding, grid: true })
        if (canvas === null) return
        canvas.toBlob((blob) => {
          if (blob === null) return
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = (title || '白板') + '.png'
          anchor.click()
          window.setTimeout(() => URL.revokeObjectURL(url), 3000)
        }, 'image/png')
      }

      const onStroke = (stroke) => {
        pushHistory()
        setStrokes((previous) => [...previous, stroke])
        scheduleSave()
      }

      const zoom = (factor) => {
        if (canvasApiRef.current !== null) canvasApiRef.current.zoomBy(factor)
      }
      const fit = () => {
        if (canvasApiRef.current !== null) canvasApiRef.current.fit()
      }

      return h('div', { className: 'wb-editor' },
        h('div', { className: 'wb-editor-head' },
          h('button', { type: 'button', className: 'wb-iconbtn', title: '返回列表', onClick: async () => { await saveNow(strokesRef.current, titleRef.current, backgroundRef.current, cameraRef.current); props.onBack() } }, h(Icon, { name: 'back' })),
          h('input', {
            className: 'wb-title-input',
            value: title,
            onChange: (event) => { setTitle(event.target.value); scheduleSave() },
            onBlur: () => { void saveNow(strokesRef.current, titleRef.current, backgroundRef.current, cameraRef.current) },
            placeholder: '白板标题',
          }),
          h('button', {
            type: 'button',
            className: 'wb-chip' + (penOnly ? ' wb-chip--on' : ''),
            title: penOnly ? '当前：手指不画线（单指拖动平移、双指缩放），数位笔/鼠标可画；点击允许手指画线' : '当前允许手指画线（单指即书写）；点击切换为仅手写笔（手指只平移/缩放）',
            onClick: () => {
              setPenOnly((previous) => {
                const next = !previous
                try { window.localStorage.setItem('dsh-whiteboard:pen-only', next ? '1' : '0') } catch { /* ignore */ }
                return next
              })
            },
          }, h('span', { className: 'wb-chip-dot' }), h('span', null, penOnly ? '仅手写笔' : '允许手指')),
          h('span', { className: 'wb-save' }, saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存' : saveState === 'error' ? '保存失败' : '已保存'),
        ),
        h('div', { className: 'wb-toolbar' },
          h('div', { className: 'wb-tools' }, ...TOOLS.map((item) => h('button', {
            key: item.id,
            type: 'button',
            title: item.hint,
            className: 'wb-tool' + (tool === item.id ? ' wb-tool--on' : ''),
            onClick: () => setTool(item.id),
          },
          h('span', { className: 'wb-tool-icon' }, h(ToolIcon, { name: item.id })),
          h('span', { className: 'wb-tool-label' }, item.label),
          ))),
          h('div', { className: 'wb-paint' },
            h('div', { className: 'wb-row' },
              h('span', { className: 'wb-swatches' },
                h('span', { className: 'wb-cap' }, '颜色'),
                ...COLORS.map((item) => h('button', {
                  key: item,
                  type: 'button',
                  className: 'wb-swatch' + (color === item ? ' wb-swatch--on' : ''),
                  style: { background: item },
                  title: item,
                  onClick: () => setColor(item),
                }))),
            ),
            h('div', { className: 'wb-row' },
              h('span', { className: 'wb-widths' },
                h('span', { className: 'wb-cap' }, '粗细'),
                ...WIDTHS.map((item) => h('button', {
                  key: item,
                  type: 'button',
                  className: 'wb-width' + (size === item ? ' wb-width--on' : ''),
                  title: '粗细 ' + item,
                  onClick: () => setSize(item),
                }, h('i', { style: { width: Math.min(18, 3 + item), height: Math.min(18, 3 + item) } })))),
              h('span', { className: 'wb-div' }),
              h(EraserSizeControl, { value: eraserDiameter, max: eraserDiameterMax, onChange: changeEraserDiameter }),
            ),
          ),
          h('div', { className: 'wb-ops' },
            h('div', { className: 'wb-row' },
              h('span', { className: 'wb-seg' },
                h('button', { type: 'button', className: 'wb-iconbtn', title: '撤销（Ctrl+Z）', onClick: undo, disabled: historyRef.current.past.length === 0 }, h(Icon, { name: 'undo' })),
                h('button', { type: 'button', className: 'wb-iconbtn', title: '重做（Ctrl+Shift+Z）', onClick: redo, disabled: historyRef.current.future.length === 0 }, h(Icon, { name: 'redo' })),
              ),
              h('span', { className: 'wb-div' }),
              h('span', { className: 'wb-seg' },
                h('button', { type: 'button', className: 'wb-iconbtn', title: background === 'grid' ? '切换为空白背景' : '切换为网格背景', onClick: () => { setBackground(background === 'grid' ? 'blank' : 'grid'); scheduleSave() } }, h(Icon, { name: 'grid' })),
              ),
              h('span', { className: 'wb-div' }),
              h('span', { className: 'wb-seg' },
                h('button', {
                  type: 'button',
                  className: 'wb-iconbtn',
                  title: '删除全部笔画（清空画布）',
                  onClick: () => {
                    if (strokes.length === 0) return
                    if (typeof window.confirm === 'function' && !window.confirm('确定清空当前白板吗？可以撤销。')) return
                    pushHistory()
                    setStrokes([])
                    scheduleSave()
                  },
                }, h(Icon, { name: 'trash' })),
              ),
              h('span', { className: 'wb-div' }),
              h('span', { className: 'wb-seg' },
                h('button', { type: 'button', className: 'wb-iconbtn', title: '导出 PNG', onClick: exportPng }, h(Icon, { name: 'download' })),
              ),
            ),
            h('div', { className: 'wb-row' },
              h('span', { className: 'wb-seg' },
                h('button', { type: 'button', className: 'wb-iconbtn', title: '缩小（也可用滚轮）', onClick: () => zoom(1 / 1.2) }, h('span', { style: { fontSize: 17, lineHeight: 1 } }, '−')),
                h('button', { type: 'button', className: 'wb-zoom-label', title: '点击适配到内容', onClick: fit }, String(Math.round(camera.scale * 100)) + '%'),
                h('button', { type: 'button', className: 'wb-iconbtn', title: '放大（也可用滚轮）', onClick: () => zoom(1.2) }, h('span', { style: { fontSize: 17, lineHeight: 1 } }, '+')),
              ),
              h('button', { type: 'button', className: 'wb-fitbtn', title: '适配到内容（也可点缩放百分比）', onClick: fit }, '适配'),
            ),
          ),
        ),
        error !== null ? h('div', { className: 'wb-error' }, error) : null,
        h(CanvasBoard, {
          strokes,
          tool,
          color,
          size,
          eraserDiameter,
          eraserSizeMax,
          background,
          penOnly,
          camera,
          setCamera,
          pendingFit,
          onFitDone: () => setPendingFit(false),
          onApi: (api) => { canvasApiRef.current = api },
          onStroke,
        }),
      )
    }

    /* ---------------- 面板 ---------------- */

    function Panel() {
      const [view, setView] = useState('list')
      const [boards, setBoards] = useState([])
      const [board, setBoard] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)
      /** 宿主支持的橡皮 size 上限：旧宿主没有该字段 → 按 60 兜底（直径 156）。 */
      const [eraserSizeMax, setEraserSizeMax] = useState(ERASER_SIZE_MAX_FALLBACK)
      /** 版本与更新检查（只提示，不下载、不自动安装）。 */
      const [appVersion, setAppVersion] = useState('')
      const [updateState, setUpdateState] = useState('idle')
      const [updateResult, setUpdateResult] = useState(null)
      const [updateTouched, setUpdateTouched] = useState(false)

      const loadBoards = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const payload = await requestJson('/boards')
          setBoards(Array.isArray(payload.boards) ? payload.boards : [])
          const sizeMax = Number(payload.eraserSizeMax)
          if (Number.isFinite(sizeMax) && sizeMax > 0) setEraserSizeMax(sizeMax)
          if (typeof payload.version === 'string' && payload.version !== '') setAppVersion(payload.version)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setLoading(false)
        }
      }, [])

      const checkUpdate = useCallback(async (force) => {
        setUpdateState('checking')
        try {
          const payload = await requestJson('/update-check' + (force ? '?force=1' : ''))
          setUpdateResult(payload)
        } catch (caught) {
          setUpdateResult({ ok: false, error: caught instanceof Error ? caught.message : String(caught) })
        } finally {
          setUpdateState('done')
        }
      }, [])

      useEffect(() => { void loadBoards() }, [loadBoards])
      // 打开列表时静默查一次（宿主侧有 10 分钟缓存）；失败不打扰用户
      useEffect(() => { void checkUpdate(false) }, [checkUpdate])

      const openBoard = async (id) => {
        setError(null)
        try {
          const payload = await requestJson('/boards/' + encodeURIComponent(id))
          setBoard(payload.board)
          setView('editor')
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }

      const createBoard = async () => {
        setError(null)
        try {
          const payload = await requestJson('/boards', { method: 'POST', body: {} })
          setBoard(payload.board)
          setView('editor')
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }

      const deleteBoard = async (target) => {
        const ok = typeof window.confirm === 'function' ? window.confirm('删除白板「' + (target.title || '未命名白板') + '」？删除后不可恢复。') : true
        if (!ok) return
        try {
          await requestJson('/boards/' + encodeURIComponent(target.id), { method: 'DELETE' })
          await loadBoards()
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }

      const backToList = () => {
        setView('list')
        setBoard(null)
        void loadBoards()
      }

      if (view === 'editor' && board !== null) {
        return h('div', { className: 'wb-root' }, h(EditorView, { board, eraserSizeMax, onBack: backToList }))
      }
      return h('div', { className: 'wb-root' },
        h('div', { className: 'wb-header' },
          h('span', { className: 'wb-header-title' }, '手写白板'),
          h('span', { className: 'wb-header-sub' }, '手写笔 / 铅笔 / 钢笔 / 毛笔 / 马克笔，支持压感与继续编辑'),
        ),
        loading ? h('div', { className: 'wb-loading' }, '正在加载白板…') : h(ListView, {
          boards,
          error,
          appVersion,
          updateState,
          updateResult,
          updateTouched,
          onCheckUpdate: () => { setUpdateTouched(true); void checkUpdate(true) },
          onCreate: createBoard,
          onOpen: openBoard,
          onDelete: deleteBoard,
        }),
      )
    }

    function apply(ctx) {
      ensureStyle()
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'whiteboard',
        order: 46,
        label: '手写白板',
      }, Glyph))
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'whiteboard',
      }, Panel))
    }

    exports.apply = apply
    exports.inject = ['slots', 'layout']
    /** 仅离线测试用：暴露纯函数与画布组件，便于验证手势/橡皮逻辑（运行时无副作用）。 */
    exports.__internals = {
      CanvasBoard,
      EditorView,
      EraserSizeControl,
      eraserStrokeSize,
      eraserDiameterLimit,
      panCamera,
      pinchCamera,
      ERASER_DIAMETER_MIN,
      ERASER_DIAMETER_MAX,
      ERASER_DIAMETER_DEFAULT,
      ERASER_WIDTH_FACTOR,
      ERASER_SIZE_MAX_FALLBACK,
      ERASER_SIZE_MAX_LATEST,
      CSS,
    }

    return module.exports
  },
})
