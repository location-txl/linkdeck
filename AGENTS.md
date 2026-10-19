# LinkDeck 开发约定

LinkDeck 是面向 Chrome 和 Edge 的 Manifest V3 扩展，使用 React、TypeScript、Vite 和 pnpm workspace。

## 模块边界

- `src/`：应用入口、页面组合、后台注册及集成测试。
- `packages/` 下的 `bookmarks`、`data-transfer`、`gist-sync`、`tab-search`、`tab-auto-close`、`same-tab-navigation`：各功能的实现、类型、存储键、样式及测试。
- `packages/ui`：共享界面组件和样式；`packages/shared`：通用工具；`packages/test-utils`：Chrome mock 和测试初始化，仅用于开发依赖。
- `public/`：扩展清单、本地化和静态资源；`scripts/`：构建校验与打包；`docs/`：商店资料与隐私说明。

内部包保持私有，依赖使用 `workspace:*`，通过明确的 `exports` 子路径引用源码。禁止跨包访问内部文件、功能包反向依赖应用入口或循环依赖。后台与注入脚本的运行时依赖不得包含 React、UI 组件或测试工具。

项目概览、浏览器加载方式和功能约定见 `README.md`；涉及发布、权限或隐私文案时读取 `docs/store-listing.md`。不要手工修改或纳入版本控制 `dist/`、`release/` 等生成产物。

## 常用命令

在仓库根目录执行，使用 `package.json` 声明的 pnpm 版本；依赖变更同步更新 `pnpm-lock.yaml`。

| 用途 | 命令 |
| --- | --- |
| 安装依赖 | `pnpm install --frozen-lockfile` |
| 开发 popup 界面 | `pnpm dev` |
| 运行全部测试 | `pnpm test` |
| 代码质量检查 | `pnpm lint` |
| 运行指定测试 | `pnpm exec vitest run <测试文件路径>` |
| 构建开发版扩展 | `pnpm build:dev` |
| 类型检查、生产构建及搜索注入脚本校验 | `pnpm build` |
| 代码质量检查、全量测试与生产构建 | `pnpm check` |
| 构建并生成商店 ZIP 包 | `pnpm package` |
| 使用本地签名密钥生成 CRX | `pnpm package:crx` |

项目使用 ESLint 检查 JavaScript 和 TypeScript，没有单独的 format 脚本。

## 数据、权限与隐私

- 收藏数据使用 `chrome.storage.sync`；自动关闭和当前标签页导航的配置保持本地，不混入收藏同步、JSON 备份或 Gist 同步。
- Gist 令牌只保存在 `chrome.storage.local`，不得进入同步数据、导出文件、日志或错误提示。不要输出或提交 `dist.pem` 等私钥。
- Gist 同步是可选功能；未连接时不请求 GitHub。secret Gist 的链接持有者可读取内容，不将其描述为加密或真正私有的存储。
- 标签页和历史搜索数据只用于当次搜索，不写入收藏、同步或上传。图标请求仅包含域名，不携带完整网址、查询参数或收藏标题。
- 网站权限按用户操作申请，不将可选授权改为默认全站访问；不引入远程脚本或遥测。
- 修改存储格式、同步合并、导入替换或权限行为时，检查兼容性和失败路径，并同步调整相关文档。

## 代码与验证

- TypeScript 开启严格检查；使用两空格缩进、单引号、无分号和多行结构尾逗号。组件使用 PascalCase，函数与变量使用 camelCase。
- 测试使用 Vitest、jsdom 和 Testing Library，文件命名为 `*.test.ts` 或 `*.test.tsx`，与实现就近放置；Chrome API mock 使用 `@linkdeck/test-utils`。
- 代码、依赖或构建配置变更交付前运行 `pnpm check`；迭代时运行受影响的测试。纯文档改动无需全量测试与构建。
- 修改模块边界或后台注册时，关注 `src/workspace.test.ts`、`src/service-worker.test.ts`；修改页面组合时关注 `src/App.test.tsx`。
- UI、网站权限、注入脚本、标签页行为和 service worker 生命周期变更需在 Chrome/Edge 加载构建后的扩展验证；无法验证时列出待验证场景，不能以 `pnpm check` 通过代替。
