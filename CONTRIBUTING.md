# 贡献流程

1. 在上游公开 GitHub 仓库提交插件、与插件实际许可证一致的 LICENSE、manifest license 和版本更新；确保提交已推送。源码可以放在独立仓库中，不要求移入 Vykor 主仓库。
2. 在根 marketplace.json 列出插件 ID、category 和 source：repository 必须是 `https://github.com/OWNER/REPO`，不带 `.git`、尾斜线、认证信息、端口、查询参数或片段；commit 必须固定为完整的 40 位小写十六进制提交号，不能用分支或标签；path 使用仓库内真实存在的目录，仓库根目录写 `.`。不要提交插件源码、依赖、生成 ZIP 或 .work。
3. 运行 npm test、npm run build、npm run verify，审查生成索引与插件授权。
4. 提交 PR；PR 只构建验证。合并 main 后自动先发布版本，再部署索引。

已经发布的版本不可更换内容；任何变化都应更新插件版本。构建失败应修复源码并使用新提交，禁止跳过校验或覆盖 release 文件。

构建会运行所选第三方源码的 build、test 和 typecheck 脚本。PR 必须使用无密钥、token 只读的 `pull_request` 构建任务验证，不使用 `pull_request_target`，不提升该任务的写权限。PR 不发布 Release 或 Pages；合并后由市场发布工作流完成分发。插件的许可证文件、组件入口、路径和归档大小限制保持不变。
