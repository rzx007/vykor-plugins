# 插件测试

`search.test.mjs` 在原生调用边界使用受控结果，实际运行范围、语料绑定、原生片段、重复位置、关闭、取消、批量状态及预算逻辑。`native-mcp.test.mjs` 启动真实 Node 夹具子进程验证 JSON-RPC、白名单、超大输出、取消与回收；`binding.test.mjs` 验证显式导入 receipt 不会伪造索引时间或覆盖已有状态。常规测试不需要下载 XERJ。

`evidence.test.mjs` 验证原生格式与当前真实文件：截断说明、页尾预算账目、普通方括号正文、定义/匹配行区别、重复片段歧义、连续正文核验和中点补读提示。补读的实际行数/字节限制由 `evaluation/__test__/retrieval.test.mjs` 覆盖。

`host-smoke.mjs` 是显式启用的真实 Vykor 宿主验证，使用 `--host-root` 指定源码路径、`--xerj-binary` 指定已校验程序。它经过真实 ToolHost 和真实 XERJ MCP 进程，在受控本机 HTTP 服务上验证加载、权限、开关及回退到宿主 Grep/Read，不改用户安装记录。真实索引的四类调用由固定语料评测与原生控制查询另行记录。

运行入口及实际服务评测见插件根 README；跨检索方式的评测测试放在 `evaluation/__test__/`。
