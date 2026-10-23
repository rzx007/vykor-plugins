# 贡献流程

1. 本仓官方插件在 `plugins/<name>/` 维护源码、LICENSE、manifest license 和版本；已有插件 ID 不变。第三方插件在自己的公开 GitHub 仓库维护，并准备已经推送的固定源码提交。
2. 根 marketplace.json 每项列出插件 ID、category，并且只声明 `localPath` 或 `source` 中的一种。官方来源写 `localPath: "plugins/<name>"`，不同时写 `source`；路径必须是 `plugins/` 的直接子目录，不能使用 `..`、反斜线、目录或文件链接。外部来源写 `source: {repository, commit, path}`：repository 为 `https://github.com/OWNER/REPO`，不带 `.git`、尾斜线、认证信息、端口、查询参数或片段；commit 固定完整的 40 位小写十六进制提交号；path 为所选提交内真实存在的子目录，如 `plugins/example`，最长 1024 字符。不得使用根目录 `.`、`./` 前缀、空路径、空分段、`.` 或 `..` 分段、冒号和反斜线；不接受绝对路径或目录逃逸。不要提交依赖、生成 ZIP、下载缓存或 .work。教学示例继续从 Vykor 固定提交获取。
3. 运行 npm test、npm run build、npm run verify，审查生成索引与插件授权。
4. 提交 PR；PR 只构建验证。合并 main 后自动先发布版本，再部署索引。手动工作流也只允许从 main 发布。

官方构建使用当前工作区中 Git 已跟踪及未忽略的新文件，复制到干净临时目录再运行插件检查；忽略的旧输出不参与归档。本地存在未提交或未跟踪文件时，构建日志及 `dist/build-provenance.json` 会标为 PREVIEW，`verify` 仍可检查包，但发布入口会拒绝。官方公开 `source.commit` 始终使用真实 HEAD；提交号应由合并后的 CI 自动填入，不能预填虚构值。CI 核对实际检出提交、构建凭据及索引摘要；发布检查可以单独运行 `npm run check:publish`，它不会调用 GitHub。

已经发布的版本不可更换内容；任何变化都应更新插件版本。构建失败应修复源码并使用新提交，禁止跳过校验或覆盖 release 文件。

宿主先解析整份公开目录，再判断 `requires.host`，因此不兼容的来源路径会使全部条目失效。输入清单、临时检出、构建后的公开索引及 `verify` 都检查上述路径规则。独立 GitHub 插件当前位于其仓库根目录，暂不加入这次五项市场迁移；待其固定提交有真实插件子目录，或另行完成兼容的宿主与目录发布后再收录，不能为通过校验而改写成不存在的路径。

构建会运行所选第三方源码的 build、test 和 typecheck 脚本。PR 必须使用无密钥、token 只读的 `pull_request` 构建任务验证，不使用 `pull_request_target`，不提升该任务的写权限。PR 不发布 Release 或 Pages；合并后由市场发布工作流完成分发。插件的许可证文件、组件入口、路径和归档大小限制保持不变。
