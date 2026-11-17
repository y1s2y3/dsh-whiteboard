# 合规性检查报告（dsh-whiteboard v0.5.0）

- 检查日期：2026-11-17
- 检查对象：`dsh-whiteboard` 手写白板插件（准备发布到 GitHub 公开仓库）
- 检查方式：静态代码扫描 + 发布包内容清单核对 + 依赖/网络端点人工复核 + 离线测试
- 结论：**通过（PASS）**，无阻断项；有 3 条使用侧注意事项（见第六节）

## 一、许可证与版权

| 检查项 | 结果 | 说明 |
|---|---|---|
| 许可证文件 | ✅ | 仓库根目录 `LICENSE`（MIT，Copyright 2025-2026 DinosaurYSL） |
| `package.json` license 字段 | ✅ | `"license": "MIT"`，与 LICENSE 一致 |
| README/INSTALL 中许可声明 | ✅ | 均标注 MIT 并链接 LICENSE |
| 第三方代码/资产 | ✅ | 无 `dependencies` / `devDependencies`；图标为手写 SVG；未内嵌第三方字体、图标库或统计脚本 |
| 版权归属 | ✅ | 代码为本项目原创；更新检查模块参考同作者自研的 meeting 插件（同为 MIT），无外部抄袭 |

## 二、密钥与隐私数据扫描

对 18 个待发布文件（`lib/`、测试、脚本、文档、配置；排除 backups/dist/截图）做正则扫描：

| 扫描项 | 命中 | 说明 |
|---|---|---|
| 云端 API Key（`sk-…`） | 0 | — |
| GitHub Token（`ghp_/gho_/github_pat_` 等） | 0 | — |
| AWS Access Key（`AKIA…`） | 0 | — |
| 私钥（`BEGIN … PRIVATE KEY`） | 0 | — |
| 本机绝对路径（`C:\Users\<用户名>`） | 0 | 文档中只用 `%USERPROFILE%` / `~` 占位 |
| 邮箱地址 | 0 | 仓库内无联系邮箱（问题反馈走 GitHub Issues） |
| 明文密码/密钥赋值 | 0 | — |

另：仓库不包含任何真实白板数据（`storages/dsh-whiteboard.json`）、会议/项目资料、`backups/` 部署备份与 `browser-screenshots/` 截图，均由 `.gitignore` 排除；发布包由 `package.mjs` 白名单生成（`lib/ + package.json + cordis.patch.yml + README/INSTALL/PRIVACY/LICENSE`）。

## 三、数据与隐私

| 检查项 | 结果 | 说明 |
|---|---|---|
| 白板内容是否上传 | ✅ 不上传 | 只写本机 `~/.dsh/storages/dsh-whiteboard.json` |
| 遥测/埋点 | ✅ 无 | 无统计 SDK、无上报接口 |
| 联网端点 | ✅ 可控 | 仅：`api.github.com`（检查更新）、`registry.npmjs.org`（更新检查备用源）、用户点击的 GitHub/npm 页面 |
| 检查更新是否发送用户数据 | ✅ 否 | 普通 GET，仅带 UA/版本号，不发送白板内容、设备标识、账号信息 |
| 「检查更新」是否自动安装 | ✅ 否 | 只提示版本与下载链接，不下载/不替换文件 |
| 隐私说明文档 | ✅ | 根目录 `PRIVACY.md`，并在 README/INSTALL 中引用 |
| 本地数据敏感性提示 | ✅ | PRIVACY 中提示本地明文 JSON、公用电脑不要保存敏感内容 |

## 四、代码与接口安全

| 检查项 | 结果 | 说明 |
|---|---|---|
| 动态代码执行 | ✅ 无 | 运行代码无 `eval` / `new Function`；测试脚本使用 `new Function` 仅用于加载客户端 bundle，不进发布包 |
| XSS | ✅ 低风险 | 界面用 React 文本节点渲染标题/内容；无 `dangerouslySetInnerHTML`；缩略图为本地生成的 `data:image/png` |
| 本地 HTTP 路由范围 | ✅ | 只挂在宿主已有 `ctx.webServer` 的 `/dsh-whiteboard` 前缀，不另开端口；请求体上限 12 MB |
| 路径穿越/文件读取 | ✅ | 路由只按内存中的白板 id 查找，不接受任意文件路径；存储文件路径固定 |
| 更新检查健壮性 | ✅ | 6 s 超时 + `AbortController`；失败静默返回错误对象，不抛出、不阻塞界面；结果缓存 10 分钟避免频繁请求 |
| 外部链接 | ✅ | `target="_blank" rel="noreferrer"`；只跳转固定的 GitHub Releases 地址 |
| 对宿主的改动 | ✅ 无 | 不修改 DSH 宿主文件；通过官方 slot/webServer 扩展，卸载即移除 |

## 五、仓库与发布合规

| 检查项 | 结果 | 说明 |
|---|---|---|
| `.gitignore` | ✅ | 排除 `node_modules/`、`dist/`、`backups/`、`browser-screenshots/`、`*.tgz`、日志 |
| `.gitattributes` | ✅ | 统一换行；图片/tgz 二进制 |
| 发布包白名单 | ✅ | `package.mjs` 只复制运行时必需文件，含 LICENSE/INSTALL/PRIVACY |
| 发布工作流权限 | ✅ | `.github/workflows/release.yml` 仅 `contents: write`，用 `GITHUB_TOKEN` 在 tag/手动触发时打包并发布 Release |
| 版本检查与发布源一致 | ✅ | `lib/update-check.js` 的 `UPDATE_REPO` 与 `package.json` repository 均为 `y1s2y3/dsh-whiteboard` |
| 测试 | ✅ | `tests/smoke-whiteboard.mjs`（含更新检查）与 `tests/gesture-whiteboard.mjs` 全部通过 |

## 六、注意事项（非阻断）

1. **本地数据为明文 JSON**：白板内容保存在本机用户目录，插件不做加密。公用电脑/敏感内容建议开启磁盘加密，或使用后手动删除该文件（PRIVACY.md 已说明）。
2. **预览图会出现在 README**：`docs/preview.png` 为示意截图（示例标题，无真实项目数据），发布前已替换为通用示例。
3. **网络受限环境下的检查更新**：部分公司网络会拦截 `api.github.com`，此时检查更新会显示失败提示，不影响白板功能；可直接访问 Releases 页手动确认版本。

## 七、复核命令（可复现）

```powershell
# 测试
node tests/smoke-whiteboard.mjs
node tests/gesture-whiteboard.mjs

# 密钥/隐私扫描（在仓库根目录执行，示例）
Get-ChildItem -Recurse -File | Where-Object { $_.FullName -notmatch '\\(backups|dist|node_modules|browser-screenshots)\\' } |
  Select-String -Pattern 'sk-[A-Za-z0-9]{16,}','gh[pousr]_[A-Za-z0-9]{20,}','C:\\Users\\','BEGIN .*PRIVATE KEY'

# 发布包内容核对
node package.mjs
tar -tzf dist/dsh-whiteboard-0.5.0.tgz
```

---

检查人：自动化合规检查（由 DSH Agent 执行）· 复核人：DinosaurYSL
