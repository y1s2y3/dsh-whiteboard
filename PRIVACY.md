# 隐私说明（dsh-whiteboard 手写白板插件）

最后更新：2026-11-17 · 适用版本：0.5.0+

## 一、数据存在哪里

- **白板内容**（标题、笔画、视图位置、缩略图）只保存在**本机**：
  - Windows：`%USERPROFILE%\.dsh\storages\dsh-whiteboard.json`
  - macOS / Linux：`~/.dsh/storages/dsh-whiteboard.json`
- 插件**不上传**白板内容、不把画布数据发送到任何服务器。
- 删除插件不会自动删除上述文件；需要清理时手动删除。

## 二、联网行为

插件只有以下两类联网行为，均**不含白板内容**：

1. **检查更新**（用户打开白板列表时自动一次、或点「检查更新」时）：
   - 请求 `https://api.github.com/repos/y1s2y3/dsh-whiteboard/releases/latest`；
   - 只发送常规 HTTP 请求头（含 IP、User-Agent），不发送任何本机数据；
   - 失败时回退查询 `https://registry.npmjs.org/dsh-whiteboard/latest`（若未发布则返回失败）；
   - 结果仅用于在界面上提示「有没有新版本」，**不自动下载、不自动安装**。
2. **用户点击「下载 / 查看说明」链接**：打开 GitHub Releases 页面，由系统浏览器处理。

## 三、不收集的信息

- 无遥测、无埋点、无账号体系；
- 不收集设备标识、使用统计、按键/笔画内容；
- 不写入任何第三方 Cookie 或存储。

## 四、第三方组件

本插件**没有第三方运行时依赖**（`package.json` 中无 `dependencies`），界面图标为手写 SVG，未内嵌第三方字体或统计脚本。
版权与许可见 [LICENSE](LICENSE)（MIT）。

## 五、安全建议

- 白板数据是本地明文 JSON，包含你写画的内容。**公用电脑不建议保存敏感内容**，建议开启磁盘加密。
- 插件只监听 DSH Desktop 自身的本地 Web 服务（`/dsh-whiteboard` 前缀），不额外开端口。

## 六、联系

问题与建议：https://github.com/y1s2y3/dsh-whiteboard/issues
