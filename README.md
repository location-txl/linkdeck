# LinkDeck

LinkDeck 是一个面向 Chrome 和 Edge 的 Manifest V3 网址收藏插件。

## 本地开发

运行：`pnpm install`，再运行：`pnpm dev`。

开发服务器便于调整 popup 界面；手动添加可用。

## 构建与加载

运行 `pnpm build` 后：

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”，选择 `dist` 目录。
4. 将 LinkDeck 固定到工具栏，点击图标打开 popup。

## 打包商店版本

运行 `pnpm package`。产物为 `release/linkdeck-v1.1.0.zip`，压缩包根目录直接包含 `manifest.json`。

如需使用根目录的 `dist.pem` 生成 CRX3，运行 `pnpm package:crx`。产物为 `release/linkdeck-v1.1.0.crx`；`dist.pem` 仅用于签名，已被 `.gitignore` 忽略，不能提交到仓库。

## 数据和隐私

- 收藏数据存放在 `chrome.storage.sync`；浏览器是否跨设备同步取决于账号和同步设置。
- 可选的 Gist 同步会把全部标签和收藏上传到用户自己的 GitHub secret Gist，用于 Chrome 与 Edge 等不同浏览器之间同步；未连接 Gist 时不会请求 GitHub。
- Gist 细粒度访问令牌仅保存在当前浏览器的 `chrome.storage.local`，不会参与浏览器同步、JSON 导出或日志。令牌需要 `Gists: write` 权限。
- 点击“收藏当前页”时，扩展仅在这次用户主动操作中读取当前标签的标题和网址。
- 图标通过 `https://favicon.im/{hostname}` 按域名加载，完整路径、查询参数和收藏标题不会发送给该服务；请求仍会让该服务获知域名与用户 IP。
- 扩展使用后台 service worker 在本机数据变更后自动同步已绑定的 Gist；没有遥测或远程脚本，仅在用户明确触发标签页搜索快捷键时临时注入当前网页。搜索浮层默认读取当前窗口标签页，按 `Tab` 切换到历史模式后才读取浏览器历史记录；历史记录只用于当次搜索，不写入 LinkDeck、同步或上传。

## 标签页快速切换

- Popup 关闭时按 `Command+Shift+P`（Windows/Linux 为 `Ctrl+Shift+P`），可在当前网页打开悬浮搜索层。
- 默认搜索当前浏览器窗口已打开标签页的标题和网址；按 `Tab` 可切换到浏览器历史记录，`Shift+Tab` 可切回。两种模式都支持 `↑`、`↓`、`Enter`、`Esc`，历史模式最多显示最近 100 条记录。标签页和历史数据只在本次搜索中使用，不写入收藏、同步或上传。
- Chrome/Edge 内部页、商店页、部分 PDF 和其他受保护页面无法注入搜索层，这是浏览器的页面安全限制。

> GitHub secret Gist 不公开展示或搜索，但并非真正私有：任何拿到 Gist 链接的人都能读取其中的明文收藏。请勿使用 Gist 同步敏感网址。

## JSON 备份

点击顶部的“数据管理”可以导出或导入 LinkDeck JSON 备份。备份包含全部标签和收藏，不包含当前标签筛选、搜索词等界面偏好。

- “智能合并”保留现有数据，按标签名称归并，并合并相同网址的标签。
- “完整替换”会在确认后使用备份内容覆盖当前标签和收藏。
- 导入文件只在扩展本地读取和校验，不会上传到网络；支持 LinkDeck 的 `formatVersion: 1` 和 `formatVersion: 2` JSON 文件。

## Gist 同步

在“数据管理”的 GitHub Gist 区域粘贴一个细粒度访问令牌。留空已有 Gist 时，LinkDeck 会创建包含 `linkdeck-sync.json` 的 secret Gist；也可以粘贴已有 LinkDeck Gist 的链接或 ID 完成绑定。

- 本机修改由后台自动上传；浏览器启动和打开 popup 时会检查远端，不进行周期轮询。
- 首次绑定已有 Gist 时可选择使用远端、使用本机或智能合并。
- 后续同步使用上次成功同步快照进行三方合并。只有同一内容在两端被不同修改时才会暂停，由用户统一选择保留本机或采用 Gist 冲突内容。
- 断开同步仅清除当前浏览器中的令牌、绑定和同步基线，不会删除本机收藏或远端 Gist。

## 发布

发布前请参阅 [商店资料与隐私模板](docs/store-listing.md)。Chrome Web Store 和 Edge Add-ons 会分别分配扩展 ID，因此两边的数据不互通。
