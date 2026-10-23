# Vykor 插件市场

官方插件分发源，适用于 Vykor >=1.2.20。

市场地址：<https://rzx007.github.io/vykor-plugins/marketplace.json>。

## 工作方式

根目录 `marketplace.json` 是唯一的插件清单：只记录插件 ID、分类、源码仓库、固定的 40 位提交和相对目录。它不是公开下载索引。源码可来自独立的公开 GitHub 仓库，地址使用 `https://github.com/OWNER/REPO`，不带 `.git`、尾斜线、认证信息、端口或查询参数。`source.path` 可用 `.` 指向仓库根目录，也可使用仓库内已有目录；真实路径必须留在本次检出目录内。

每次构建都创建干净的临时检出，核对实际 HEAD 与固定提交一致。一次构建内，相同仓库和提交可复用检出；不同仓库即使提交号相同也分别获取并检查来源。随后在各插件目录执行 `npm ci --ignore-scripts`、构建、已有测试和类型检查，生成确定性 ZIP，最后清理临时目录。仓库不保存完整插件源码。

`dist/marketplace.json` 才是公开索引。版本取自插件清单，组件种类取自 components，Node 要求取自 package.json engines。ZIP 包含与宿主示例打包器相同的插件目录树，排除依赖、Git 和用户运行数据。时间固定为 2000-01-01，文件权限固定为 0644，路径排序。

发布顺序是先核验 ZIP、创建草稿版本、上传 ZIP、发布不可变版本，再部署 Pages 索引。相同版本只允许相同 SHA-256；重试复用相同文件，不覆盖旧文件。PR 只构建验证，不发布插件；合并 main 后由市场工作流发布 Release 和 Pages。构建会执行第三方源码，PR 构建任务不注入密钥，token 仅有读取权限；只有独立的发布任务可写 release，只有 Pages 任务可部署网站。不要把 PR 改为 `pull_request_target` 或提高构建任务的 token 权限。

## 本地使用

需要 Node >=24、npm、Git。发布另需已登录 GitHub CLI。

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run verify
```

构建会执行上游插件代码，请先审查所选提交。压缩大小不超过 100 MiB，解压总量不超过 250 MiB，文件数量不超过 5000。禁止链接、路径逃逸、预发布版本、缺失清单/许可证/组件入口。

公开格式与示例见 [CONTRACT.md](CONTRACT.md)。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。分发工具采用 MIT；各插件附带自己的许可证。

## 插件展示信息

插件清单中的 `displayName`、`icon`、`description`、`introduction`、`prompts` 和 `homepage` 用于桌面市场及详情页。构建从固定源码的实际清单读取，不另维护展示信息副本。`prompts` 沿用插件详情的使用示例格式（最多 16 项，每项标题不超过 100 字符、正文不超过 16384 字符）；显示示例不授予执行权限。

`icon` 使用图片 base64 data URI 或 HTTPS 地址，原 ZIP 清单和文件保持原样。包内图片应在作者构建时转成 data URI 写入清单，不把相对路径交给宿主。图片数据字符串上限为 1 MiB，整个市场目录保持 2 MiB 上限。未声明图标的插件使用宿主默认图标。展示信息不声明或授予任何工具权限。

## 正式插件与目录入口

现有 Vykor 仓库中的正式插件位于 `plugins/`：Excalidraw 为 `plugins/excalidraw`，研究与写作为 `plugins/knowledge-work`，办公文档为 `plugins/office-work`。示例插件仍位于 `examples/plugins/`。新增插件可在自己的公开 GitHub 仓库维护，通过根清单收录，无需复制源码到市场或 Vykor 主仓库。更新根清单时必须同时固定包含所选目录的真实源码提交，不把旧提交与新目录拼接。

Skill 与 Agent 组件支持宿主已有的目录入口：分别检查其中存在 `SKILL.md` 或 Markdown 文件；工具、MCP 和应用配置仍要求真实文件。办公插件由自己的构建准备固定版本并验证摘要的多平台引擎，归档不依赖桌面注入文件；100 MiB 压缩、250 MiB 解压限制保持不变。
