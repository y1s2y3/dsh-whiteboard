#!/usr/bin/env node
/**
 * 把插件打包成可以直接安装/发给别人的插件包（tar.gz）。
 *
 * 用法：
 *   node package.mjs                                    # 用 package.json 的名字和版本
 *   node package.mjs --version 0.5.1                    # 临时覆盖版本
 *   node package.mjs --out D:\dist                      # 指定输出目录（默认 ./dist）
 *
 * 产物：dist/<包名>-<版本>.tgz（内含 <包名>/ 目录，解压后整个目录复制到 node_modules）
 * 同时会在 dist/ 写一份《安装说明-<版本>.md》。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 打进 tgz 的文件/目录（白名单，避免把 backups/测试/截图带进发布包）。 */
const FILES = ['package.json', 'cordis.patch.yml', 'README.md', 'INSTALL.md', 'PRIVACY.md', 'LICENSE']
const DIRS = ['lib']

function parseArgs(argv) {
  const options = { name: null, version: null, out: path.join(HERE, 'dist') }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--name') { options.name = argv[index + 1]; index += 1; }
    else if (arg === '--version') { options.version = argv[index + 1]; index += 1; }
    else if (arg === '--out') { options.out = path.resolve(argv[index + 1]); index += 1; }
    else if (arg === '--help' || arg === '-h') { console.log('用法见文件头部注释'); process.exit(0); }
  }
  return options
}

function copyTree(source, target) {
  fs.mkdirSync(target, { recursive: true })
  let count = 0
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) count += copyTree(from, to)
    else {
      fs.copyFileSync(from, to)
      count += 1
    }
  }
  return count
}

function installGuide(name, version) {
  return `# ${name} v${version} 安装说明

> 维护者：DinosaurYSL · 许可：MIT（授权文本见包内 \`LICENSE\`）· 仓库：https://github.com/y1s2y3/dsh-whiteboard

## 这是什么

DSH Desktop（DeepSeek Harness）的「手写白板」插件：在左侧「手写白板」面板里新建白板，用手写笔/鼠标写画，支持压感、单指平移、双指缩放、像素级橡皮与可调橡皮大小，白板保存在本机。

## 环境前提

| 前提 | 是否必须 | 说明 |
|---|---|---|
| DSH Desktop | 必须 | 在 DSH Desktop 2.0.17 上实测；插件面板能力来自宿主 |
| Windows / macOS / Linux | 均可 | 插件本身是纯前端 + 本地 HTTP 存储；手写笔压感取决于设备与浏览器 |
| 手写笔 / 鼠标 | 建议 | 触屏设备可用手指（需在工具栏切到「允许手指」），写字建议用笔 |

## 安装（手工，最稳）

1. 解压本 tgz，得到 \`${name}\` 目录；
2. 把它复制到：
   \`%USERPROFILE%\\.dsh\\profiles\\desktop\\node_modules\\\`（macOS/Linux 为 \`~/.dsh/profiles/desktop/node_modules/\`）；
3. 打开 \`%USERPROFILE%\\.dsh\\profiles\\desktop\\package.json\`：
   - 在 \`dependencies\` 里加一行 \`"${name}": "${version}"\`；
   - 在 \`dsh.profile.bundles\` 数组里加 \`"${name}"\`；
4. 完全退出并重启 DSH Desktop（不是刷新页面）；
5. 左侧栏出现「手写白板」图标即安装成功。

> 说明：desktop profile 由桌面端独占管理，命令行 \`dsh plugin --profile desktop add ...\` 通常会被拒绝，不要依赖它。

## 更新

- 插件列表页有「检查更新」，会查询 GitHub Releases 的最新版本并给出下载入口（**不会自动下载/安装**）；
- 手动更新：完全退出 DSH Desktop → 用新包覆盖 \`node_modules\\${name}\` → 重启；
- 白板数据保存在用户目录，覆盖插件不会删除数据。

## 卸载

删除 \`node_modules\\${name}\` 目录，并从 profile \`package.json\` 的 \`dependencies\` 和
\`dsh.profile.bundles\` 里删掉 \`${name}\`，然后重启 Desktop。

## 数据与隐私

白板数据只保存在本机：\`%USERPROFILE%\\.dsh\\storages\\dsh-whiteboard.json\`（macOS/Linux 为 \`~/.dsh/storages/dsh-whiteboard.json\`）。
不上传云端、无遥测；联网只发生在「检查更新/查看发布页」时（见 [PRIVACY.md](PRIVACY.md)）。
删除插件不会自动删除该数据文件。
`;
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'))
  const name = options.name ?? manifest.name
  const version = options.version ?? manifest.version
  const outDir = options.out
  fs.mkdirSync(outDir, { recursive: true })

  // 1. 暂存：按白名单复制 + 改写 package.json（包名/版本可覆写）
  const stageRoot = path.join(outDir, 'stage')
  fs.rmSync(stageRoot, { recursive: true, force: true })
  const staged = path.join(stageRoot, name)
  fs.mkdirSync(staged, { recursive: true })
  let count = 0
  for (const file of FILES) {
    const from = path.join(HERE, file)
    if (!fs.existsSync(from)) continue
    fs.copyFileSync(from, path.join(staged, file))
    count += 1
  }
  for (const dir of DIRS) {
    const from = path.join(HERE, dir)
    if (fs.existsSync(from)) count += copyTree(from, path.join(staged, dir))
  }
  fs.writeFileSync(path.join(staged, 'package.json'), `${JSON.stringify({ ...manifest, name, version }, null, 2)}\n`, 'utf8')

  // 2. 打 tgz（Windows/macOS/Linux 均自带 tar）
  const tarball = path.join(outDir, `${name}-${version}.tgz`)
  if (fs.existsSync(tarball)) fs.rmSync(tarball)
  execFileSync('tar', ['-czf', tarball, '-C', stageRoot, name], { stdio: 'inherit' })
  const tarballInfo = fs.statSync(tarball)

  // 3. 安装说明（中文名给本地用；ASCII 名给 GitHub Release 附件用，避免上传时非 ASCII 文件名被截断）
  const guideFile = path.join(outDir, `安装说明-${version}.md`)
  fs.writeFileSync(guideFile, installGuide(name, version), 'utf8')
  const asciiGuideFile = path.join(outDir, `install-guide-${version}.md`)
  fs.writeFileSync(asciiGuideFile, installGuide(name, version), 'utf8')

  console.log('')
  console.log('[完成] 打包产物')
  console.log(`  包文件 : ${tarball}  (${(tarballInfo.size / 1024).toFixed(0)} KB)`)
  console.log(`  文件数 : ${count}`)
  console.log(`  说明   : ${guideFile}`)
  console.log(`           ${asciiGuideFile}`)
}

main()
