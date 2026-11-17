# dsh-whiteboard · 手写白板（DSH 插件）

> DSH Desktop（DeepSeek Harness）的手写白板插件：左侧「手写白板」面板里新建/继续编辑白板，支持手写笔压感、单指平移、双指缩放、像素级橡皮、可调橡皮大小，白板保存在本机。
>
> 维护者：**DinosaurYSL** · 许可：MIT · 在 DSH Desktop 2.0.17 上实测

![工具栏三栏布局](docs/preview.png)

## 功能

- **历史白板列表**：按最近编辑时间排序，显示缩略图、标题、时间与笔画数；可继续编辑、重命名、删除。
- **无限画布 + 触屏手势**：
  - **单指拖动平移**（仅手写笔模式下手指只做平移、不画线；笔写时落下的手指在抬笔后无需重按，继续推动即可接管平移）；
  - **双指放大缩小**：以两指中点为中心缩放，同时跟手平移；滚轮缩放、空格/「抓手」拖动平移；
  - 打开白板自动适配到已有内容，视图位置随白板保存。
- **三栏工具栏**：
  - 左栏：笔型/工具（铅笔 / 钢笔 / 毛笔 / 马克笔 / 橡皮 / 抓手，3×2 两行大按钮，图标 + 文字）；
  - 中栏：12 色色板（单放一行）+ 笔粗细 + 橡皮大小；
  - 右栏：撤销·重做 ｜ 网格 ｜ 删除 ｜ 导出，以及缩放（− 100% +）与「适配」；
  - 「仅手写笔」模式开关在标题栏右侧；三栏用竖线分隔、两行内容上下对齐。
- **手写绘制**：
  - 笔型：铅笔（颗粒感）、钢笔（顺滑）、毛笔（随压感/速度变粗细）、马克笔（半透明宽笔）、橡皮（**像素级擦除**，只擦掉划过的部分）；
  - 数位笔压感 + **笔上橡皮按钮/侧键**：按住笔上的橡皮键拖动即临时擦除（兼容 Pointer Events 的 eraser button 5 与侧键 button 2），松开恢复当前笔型；
  - **橡皮擦大小可拖动调整**：滑块 6–400 世界像素（`[` / `]` 微调），画布上有跟随指针的圆圈预览真实大小；宿主未重启时按旧上限 156 兜底，避免大橡皮保存被截断；
  - 撤销 / 重做（最多 50 步）、清空、网格背景开关、导出 PNG。
- **检查更新**：打开列表时静默检查一次 + 手动「检查更新」，查 GitHub Releases 最新版本；**只提示，不下载、不自动安装**，不影响本机白板数据。
- **自动保存**：编辑后自动保存到本机，列表缩略图同步更新。
- **侧栏样式**：顺带把左侧「全局面板」入口的图标放大到 18px、文字放大到 14px（折叠态不变）。

## 安装

从 [Releases](https://github.com/y1s2y3/dsh-whiteboard/releases) 下载 `dsh-whiteboard-<版本>.tgz`，
解压后按 [INSTALL.md](INSTALL.md) 手工安装（复制到 `node_modules` 并在 profile `package.json` 登记，重启 Desktop）。

已安装后升级：列表页「检查更新」会提示新版本；手动覆盖 `node_modules/dsh-whiteboard` 后重启即可，**数据不会丢**。

## 数据与隐私

- 白板内容只保存在本机 `~/.dsh/storages/dsh-whiteboard.json`（Windows 为 `%USERPROFILE%\.dsh\storages\dsh-whiteboard.json`）；
- **不上传云端、无遥测**；
- 联网只发生在「检查更新 / 打开 Releases 链接」时，不发送白板内容。详见 [PRIVACY.md](PRIVACY.md)。

## 开发

```
lib/client.js       浏览器半：列表 + 画布（原生 Canvas 2D，手写 React 渲染）
lib/index.js        宿主半入口（注册 /dsh-whiteboard 路由）
lib/server.js       本地 HTTP API（白板 CRUD / 健康检查 / 检查更新）
lib/store.js        本地 JSON 存储（$DSH_HOME/storages/dsh-whiteboard.json）
lib/update-check.js 版本更新检查（只提示，不下载）
tests/              离线测试（smoke + 手势模拟 + 工具栏预览）
deploy.mjs          部署到本机 DSH Desktop profile（开发用，自动备份）
package.mjs         打包成可分发的 tgz 并生成安装说明
```

```powershell
# 离线测试（不需要启动 DSH）
node tests/smoke-whiteboard.mjs
node tests/gesture-whiteboard.mjs

# 部署到本机 desktop profile（会备份当前线上版本；改动宿主半后需重启 Desktop）
node deploy.mjs

# 打包：dist/dsh-whiteboard-<版本>.tgz + dist/安装说明-<版本>.md
node package.mjs
```

发布：在 [Releases](https://github.com/y1s2y3/dsh-whiteboard/releases) 上传 `dist/` 里的 tgz；
或推送 `v*` 标签由 `.github/workflows/release.yml` 自动打包发布（见工作流文件）。

## 兼容性

- 在 **DSH Desktop 2.0.17**（dsh 0.2.0-rc.2）上实测通过；
- 依赖宿主提供 `sidebar.panellist`、`main` 两个 slot 与 `ctx.webServer`；低版本宿主可能不兼容。

## 更新日志

见 [Releases](https://github.com/y1s2y3/dsh-whiteboard/releases) 与 `docs/RELEASE-NOTES-*.md`。

## 许可

MIT，见 [LICENSE](LICENSE)。
