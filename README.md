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

运行 `pnpm package`。产物为 `release/linkdeck-v1.0.0.zip`，压缩包根目录直接包含 `manifest.json`。

## 数据和隐私

- 收藏数据存放在 `chrome.storage.sync`；浏览器是否跨设备同步取决于账号和同步设置。
- 点击“收藏当前页”时，扩展仅在这次用户主动操作中读取当前标签的标题和网址。
- 图标通过 `https://favicon.im/{hostname}` 按域名加载，完整路径、查询参数和收藏标题不会发送给该服务；请求仍会让该服务获知域名与用户 IP。
- 扩展没有后台服务、遥测、远程脚本或站点访问权限。

## 发布

发布前请参阅 [商店资料与隐私模板](docs/store-listing.md)。Chrome Web Store 和 Edge Add-ons 会分别分配扩展 ID，因此两边的数据不互通。
