# 安装与使用（给使用者）

> 本插件是 DSH Desktop（DeepSeek Harness）的「手写白板」：在手写笔/鼠标下无限画布写画，支持压感、单指平移、双指缩放、像素级橡皮与可调橡皮大小，白板保存在本机。
>
> 只想安装使用、不参与开发的话，看这一个文件就够了。

## 一、环境前提

| 前提 | 是否必须 | 说明 |
| :-- | :-- | :-- |
| DSH Desktop | 必须 | 在 DSH Desktop 2.0.17 上实测；插件依赖宿主的侧栏面板与本地 Web 服务 |
| Windows / macOS / Linux | 均可 | 插件是纯前端 + 本地 JSON 存储，不依赖系统专用能力 |
| 手写笔 / 鼠标 | 建议 | 触屏设备可用手指（工具栏切「允许手指」）；写字建议数位笔，压感取决于设备 |

## 二、安装

### 2.1 方式一：下载发布包安装（推荐）

1. 在 [GitHub Releases](https://github.com/y1s2y3/dsh-whiteboard/releases) 下载 `dsh-whiteboard-<版本>.tgz`；
2. 解压 tgz，得到 `dsh-whiteboard/` 目录；把它复制到
   `%USERPROFILE%\.dsh\profiles\desktop\node_modules\` 下（macOS/Linux：`~/.dsh/profiles/desktop/node_modules/`）；
3. 编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`：
   - `dependencies` 里加一行：`"dsh-whiteboard": "<版本号>"`；
   - `dsh.profile.bundles` 数组里加：`"dsh-whiteboard"`；
4. **完全退出并重启 DSH Desktop**（不是刷新页面）；
5. 左侧栏出现「手写白板」图标即安装成功。

### 2.2 方式二：桌面端插件页

如果当前 DSH 版本的「插件」页支持**从本地文件安装**，可以直接选择下载好的 tgz；
如果只支持在线包/市场插件，请按 2.1 手工安装。

> 说明：desktop profile 由桌面端独占管理，命令行 `dsh plugin --profile desktop add ...` 通常会被拒绝，不要依赖它。

## 三、首次使用

1. 打开左侧「手写白板」：先看到历史白板列表；
2. 点「新建白板」进入画布，用笔/鼠标书写；手势：单指拖动平移、双指缩放、滚轮缩放、空格+拖动平移；
3. 工具栏三栏：左栏选笔型/工具，中栏调颜色（12 色）、粗细、橡皮大小，右栏是撤销/网格/删除/导出/缩放；
4. 编辑后自动保存；列表缩略图同步更新；可导出 PNG。

## 四、版本与更新

- 白板列表页有「检查更新」：自动静默检查一次，也可手动点；
- 查询 [GitHub Releases](https://github.com/y1s2y3/dsh-whiteboard/releases) 的最新版本，**只提示、不自动下载安装**；
- 手动更新：完全退出 DSH Desktop → 下载新 tgz → 覆盖 `node_modules\dsh-whiteboard` → 重启；
- **白板数据不会因为更新而丢失**。

## 五、卸载

删除 `node_modules\dsh-whiteboard\` 目录，并从 profile 的 `package.json` 里删掉
`dependencies`、`dsh.profile.bundles` 中的 `dsh-whiteboard`，然后重启 Desktop。

数据不会自动删除：需要清理时删除 `%USERPROFILE%\.dsh\storages\dsh-whiteboard.json`（macOS/Linux：`~/.dsh/storages/dsh-whiteboard.json`）。

## 六、常见问题

- **手写笔写不出、只能平移**：工具栏默认「仅手写笔」模式，手指只平移；用笔书写，或点「允许手指」。
- **抬笔后手指要等约 1 秒才生效**：Windows 的「笔悬停防误触」在笔仍悬停屏幕上方时会暂时禁用触控；把笔移离屏幕一点即可（与插件无关）。
- **橡皮擦不够大**：工具栏「橡皮大小」滑块最大 400 世界像素；若拖动上限只有 156，说明宿主还没重启加载新版存储上限，重启 Desktop 一次即可。
- **检查更新失败**：公司网络可能拦截 GitHub API；可稍后重试，或直接去 Releases 页看版本。

## 七、数据与隐私

- 白板数据**只存本机**，不上传；插件无遥测；
- 联网只在「检查更新 / 打开 Releases 链接」时发生，且不发送白板内容；
- 详见 [PRIVACY.md](PRIVACY.md)。

## 八、许可

MIT，授权文本见 [LICENSE](LICENSE)。维护者：DinosaurYSL。
