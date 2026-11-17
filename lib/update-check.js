/**
 * 版本更新检查（浏览器端「检查更新」按钮用）。
 *
 * 只做「提示」：查询发布源的最新版本号，返回是否有更新和下载页地址；
 * **不下载、不替换、不自动安装**，也不上传任何本机数据或白板内容。
 *
 * 查询顺序：
 *   ① GitHub Releases API（本仓库的发布源）
 *   ② npm registry（以后若发布到 npm，可作为国内网络的备用查询）
 *
 * 结果缓存 10 分钟，避免用户连点；`force: true` 时跳过缓存。
 */

import { readFileSync } from 'node:fs'

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/** 当前安装版本（取自插件 package.json） */
export const CURRENT_VERSION = String(PKG.version ?? '0.0.0')

/** 包名 */
export const PACKAGE_NAME = String(PKG.name ?? 'dsh-whiteboard')

/** 默认仓库；package.json 里填了 repository 时优先使用那里的 GitHub 地址 */
export const DEFAULT_REPO = 'y1s2y3/dsh-whiteboard'

function repoFromPackage(manifest) {
  const raw = typeof manifest?.repository === 'string'
    ? manifest.repository
    : (typeof manifest?.repository?.url === 'string' ? manifest.repository.url : '')
  const match = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:[#?].*)?$/i.exec(String(raw))
  return match ? `${match[1]}/${match[2]}` : null
}

/** 实际用于查 GitHub Releases 的仓库（owner/repo） */
export const UPDATE_REPO = repoFromPackage(PKG) ?? DEFAULT_REPO

/** GitHub Releases 页地址 */
export function githubReleaseUrl(repo = UPDATE_REPO) {
  return `https://github.com/${repo}/releases/latest`
}

/**
 * 比较两个版本号：a > b 返回 1，相等 0，a < b 返回 -1。
 * 兼容 `v1.2.3`、`1.2.3-beta.1`（预发布后缀忽略）等写法。
 */
export function compareVersions(a, b) {
  const parse = (value) => String(value ?? '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part))
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const x = left[index] ?? 0
    const y = right[index] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

const CACHE_TTL_MS = 10 * 60 * 1000
let cached = null

/** 测试用：清空缓存 */
export function resetUpdateCache() {
  cached = null
}

async function fetchJson(fetcher, url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (typeof timer.unref === 'function') timer.unref()
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': `${PACKAGE_NAME}/${CURRENT_VERSION}` },
    })
    if (!response || response.ok !== true) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 查询最新版本。
 * @param {object} [options]
 * @param {boolean} [options.force] 跳过 10 分钟缓存
 * @param {Function} [options.fetcher] 便于测试注入的 fetch
 * @param {number} [options.timeoutMs] 单次请求超时
 * @returns {Promise<{ok:boolean,current:string,latest:string|null,hasUpdate:boolean,url:string,source:string|null,error:string|null}>}
 */
export async function checkForUpdate(options = {}) {
  const { force = false, fetcher = globalThis.fetch, timeoutMs = 6000 } = options
  if (!force && cached !== null && Date.now() - cached.at < CACHE_TTL_MS) return cached.result

  const remember = (result) => {
    cached = { at: Date.now(), result }
    return result
  }

  // ① GitHub Releases（仓库公开后可用）
  const githubPayload = await fetchJson(fetcher, `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, timeoutMs)
  const tag = typeof githubPayload?.tag_name === 'string'
    ? githubPayload.tag_name
    : (typeof githubPayload?.name === 'string' ? githubPayload.name : '')
  if (tag !== '') {
    const latest = String(tag).replace(/^v/i, '')
    return remember({
      ok: true,
      current: CURRENT_VERSION,
      latest,
      hasUpdate: compareVersions(latest, CURRENT_VERSION) > 0,
      url: githubReleaseUrl(),
      source: 'github',
      error: null,
    })
  }

  // ② npm registry：仓库访问不到时的兜底（包发布到 npm 后才有效）
  const npmPayload = await fetchJson(fetcher, `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`, timeoutMs)
  if (npmPayload !== null && typeof npmPayload.version === 'string' && npmPayload.version !== '') {
    return remember({
      ok: true,
      current: CURRENT_VERSION,
      latest: npmPayload.version,
      hasUpdate: compareVersions(npmPayload.version, CURRENT_VERSION) > 0,
      url: `https://www.npmjs.com/package/${PACKAGE_NAME}`,
      source: 'npm',
      error: null,
    })
  }

  return remember({
    ok: false,
    current: CURRENT_VERSION,
    latest: null,
    hasUpdate: false,
    url: githubReleaseUrl(),
    source: null,
    error: '检查更新失败：网络不可用，或仓库还没有发布 Release。可稍后重试。',
  })
}
