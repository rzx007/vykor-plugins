# 检索评测行为测试

`retrieval.test.mjs` 用真实临时文件与 `rg` 验证检索、字节限制、证据窗口、路径边界、降级执行和人工证据失效检查；同时验证前 5 个不同文件与证据行的评分。`evaluate.test.mjs` 验证命令行参数和报告不会把未测模型指标写成零。

入口是 `node --test plugins/xerj-search/evaluation/__test__/*.test.mjs`。测试状态保存在各自临时目录，结束后清理。新用例放在这里；生产插件网络调用与真实索引收益用上层 `evaluate.mjs` 另行验收，不能用虚构命中替代。
