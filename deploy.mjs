#!/usr/bin/env node
/**
 * 把 dsh-whiteboard 部署到本机 DSH Desktop 的 desktop profile（开发用）：
 *   1) 备份并复制 lib/package.json/cordis.patch.yml 到 profile 的 node_modules/dsh-whiteboard；
 *   2) 在 profile package.json 的 dependencies 与 dsh.profile.bundles 中登记。
 * 用法：node deploy.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PKG_NAME = 'dsh-whiteboard'
const profileDir = path.join(os.homedir(), '.dsh', 'profiles', 'desktop')
const modulesDir = path.join(profileDir, 'node_modules')
const target = path.join(modulesDir, PKG_NAME)
const profilePkg = path.join(profileDir, 'package.json')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else {
      if (fs.existsSync(to)) {
        try { fs.chmodSync(to, 0o666) } catch { /* ignore */ }
      }
      fs.copyFileSync(from, to)
    }
  }
}

function timestamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())
}

if (!fs.existsSync(profilePkg)) {
  console.error('[错误] 找不到 DSH desktop profile：' + profilePkg)
  process.exit(1)
}
fs.mkdirSync(modulesDir, { recursive: true })

if (fs.existsSync(target)) {
  const backup = path.join(ROOT, 'backups', timestamp(), PKG_NAME)
  copyTree(target, backup)
  console.log('已备份旧版本 → ' + backup)
}

fs.mkdirSync(target, { recursive: true })
for (const name of ['package.json', 'cordis.patch.yml', 'README.md']) {
  const source = path.join(ROOT, name)
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, name))
}
copyTree(path.join(ROOT, 'lib'), path.join(target, 'lib'))
console.log('已复制插件 → ' + target)

const document = JSON.parse(fs.readFileSync(profilePkg, 'utf8'))
document.dependencies = document.dependencies ?? {}
document.dependencies[PKG_NAME] = pkg.version
document.dsh = document.dsh ?? {}
document.dsh.profile = document.dsh.profile ?? {}
const bundles = Array.isArray(document.dsh.profile.bundles) ? document.dsh.profile.bundles : []
if (!bundles.includes(PKG_NAME)) bundles.push(PKG_NAME)
document.dsh.profile.bundles = bundles
fs.writeFileSync(profilePkg, JSON.stringify(document, null, 2) + '\n', 'utf8')
console.log('已登记到 profile：dependencies + dsh.profile.bundles')
console.log('')
console.log('下一步：完全退出并重启 DSH Desktop，侧栏会出现「手写白板」面板。')
