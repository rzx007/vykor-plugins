# Vykor 插件市场

官方插件分发源，适用于 Vykor >=1.2.20。

市场地址：<https://rzx007.github.io/vykor-plugins/marketplace.json>。

## 工作方式

根目录 `marketplace.json` 是唯一的收录清单，不是公开下载索引。每项记录插件 ID、分类，以及以下两种来源之一，不能同时声明：

- 本仓官方插件使用 `localPath: "plugins/<name>"`。Excalidraw、研究与写作、办公文档及 XERJ 检索的源码在本仓维护；真实目录必须留在 `plugins/` 下，不接受目录或文件链接。
- 外部插件使用 `source: {repository, commit, path}`，固定完整的 40 位提交。独立仓库和 Vykor 教学示例可使用这种方式，但插件必须位于真实子目录。仓库地址为 `https://github.com/OWNER/REPO`，不带 `.git`、尾斜线、认证信息、端口或查询参数；`path` 如 `plugins/example`，不能写仓库根目录 `.`、`./...`、空路径或包含空分段、`.`、`..`、冒号、反斜线的路径，真实路径必须留在检出目录内。

每次构建都创建干净的临时目录。官方插件从当前工作区复制 Git 已跟踪及未忽略的新文件，忽略的 `dist`、依赖和下载缓存不参与复制；外部插件获取固定提交，并核对实际 HEAD。一次构建内，相同仓库和提交可复用检出，不同仓库分别验证。随后在临时插件目录执行 `npm ci --ignore-scripts`、构建、已有测试和类型检查；声明了 `test:stdio` 的插件还会启动实际构建产物检查 MCP 服务，失败即停止打包。全部通过后生成确定性 ZIP，最后清理临时目录，不修改官方插件的工作区产物。

`dist/marketplace.json` 才是公开索引，公开格式保持不变。官方插件的 `source` 自动写为本仓地址、构建开始时实际检出的 HEAD 和 `localPath`；外部来源保持固定提交。版本取自插件清单，组件种类取自 components，Node 要求取自 package.json engines。ZIP 排除依赖、Git 和用户运行数据，时间固定为 2000-01-01，文件权限固定为 0644，路径排序。每次构建先清理旧 `dist/`，避免残留归档混入分发。

`dist/build-provenance.json` 单独记录市场实际提交、索引摘要及 `preview` 状态，不添加到公开索引格式。构建开始或结束时存在未提交或未跟踪文件，产物就标为 PREVIEW；可以本地验证，但禁止发布。它记录真实 HEAD，不为未提交改动编造提交号。CI 用 `MARKET_BUILD_COMMIT` 对照实际 HEAD，提交不一致立即失败；发布还核对凭据中的索引摘要和当前 CI 提交。

发布顺序是先核验 ZIP 和构建凭据、创建草稿版本、上传 ZIP、发布不可变版本，再部署 Pages 索引。相同版本只允许相同 SHA-256；重试复用相同文件，不覆盖旧文件。PR 只构建验证；仅 main 分支的 push 或手动工作流可发布 Release 和 Pages。构建任务不保存 Git 凭据、不注入发布密钥，token 只读；只有独立发布任务可写 release，只有 Pages 任务可部署网站。不要使用 `pull_request_target` 或提高构建任务权限。

## 本地使用

需要 Node >=24、npm、Git。发布另需已登录 GitHub CLI。

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run verify
```

`npm test` 只运行市场构建工具测试；完整构建另行运行各插件自己的检查。`npm run check:publish` 只检查发布条件，不进行远端操作；`npm run publish:market` 使用同一检查，且仅接受与构建提交匹配的 main 分支 GitHub Actions 环境。

构建会执行上游插件代码，请先审查所选提交。压缩大小不超过 100 MiB，解压总量不超过 250 MiB，文件数量不超过 5000。禁止链接、路径逃逸、预发布版本、缺失清单/许可证/组件入口。

公开格式与示例见 [CONTRACT.md](CONTRACT.md)，贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。目录说明：[官方插件](plugins/README.md)、[构建与发布脚本](scripts/README.md)、[市场工具测试](test/README.md)。分发工具采用 MIT；各插件附带自己的许可证。

## 插件展示信息

插件清单中的 `displayName`、`icon`、`description`、`introduction`、`prompts` 和 `homepage` 用于桌面市场及详情页。构建从所选源码的实际清单读取，不另维护展示信息副本。`prompts` 沿用插件详情的使用示例格式（最多 16 项，每项标题不超过 100 字符、正文不超过 16384 字符）；显示示例不授予执行权限。

`icon` 使用图片 base64 data URI 或 HTTPS 地址，原 ZIP 清单和文件保持原样。包内图片应在作者构建时转成 data URI 写入清单，不把相对路径交给宿主。图片数据字符串上限为 1 MiB，整个市场目录保持 2 MiB 上限。未声明图标的插件使用宿主默认图标。展示信息不声明或授予任何工具权限。

## 正式插件与目录入口

市场包含：本仓 [plugins/](plugins/README.md) 中的 Excalidraw、研究与写作、办公文档及 [XERJ 代码与资料搜索](plugins/xerj-search/README.md)，独立 GitHub 工作流插件，以及 Vykor `examples/plugins/` 中的两个固定提交示例。插件 ID 保持不变。新增第三方插件可在自己的公开 GitHub 仓库的真实子目录维护，通过 `source` 收录；新增本仓官方插件使用 `localPath`，无需在自身清单里写尚未产生的提交号。

[独立 GitHub 插件](https://github.com/rzx007/vykor-plugin-github/tree/main/plugins/github)以真实子目录 `plugins/github` 收录，稳定 ID 为 `dev.vykor.github`。根路径 `.` 仍被拒绝：已发布宿主在最低版本判断前解析整份目录，提高 `requires.host` 不能绕过路径要求。

Skill 与 Agent 组件支持宿主已有的目录入口：分别检查其中存在 `SKILL.md` 或 Markdown 文件；工具、MCP 和应用配置仍要求真实文件。办公插件由自己的构建准备固定版本并验证摘要的多平台引擎，归档不依赖桌面注入文件；100 MiB 压缩、250 MiB 解压限制保持不变。
