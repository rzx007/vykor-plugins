# 贡献流程

1. 在上游提交插件、MIT LICENSE、manifest license 和版本更新；确保提交已推送。
2. 只修改根 marketplace.json 的固定 source.commit、source.path 或 category，新增插件也在此列出。不要提交插件源码、依赖、生成 ZIP 或 .work。
3. 运行 npm test、npm run build、npm run verify，审查生成索引与插件授权。
4. 提交 PR；PR 只构建验证。合并 main 后自动先发布版本，再部署索引。

已经发布的版本不可更换内容；任何变化都应更新插件版本。构建失败应修复源码并使用新提交，禁止跳过校验或覆盖 release 文件。
